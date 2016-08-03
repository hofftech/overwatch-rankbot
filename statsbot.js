if (process.env.NODE_ENV != "production") {
	require('dotenv').config();
}

var async = require('async');
var leftPad = require('left-pad'); // just cuz

var Sequelize = require('sequelize');
var sequelize = new Sequelize(process.env.POSTGRES_URL, {
	dialectOptions: {
		ssl: true
	}
});

var Channel = sequelize.define('channel', {
	channel_id: Sequelize.BIGINT,
	players: Sequelize.ARRAY(Sequelize.TEXT)
})

var TrackedPlayers = sequelize.define("tracked_players", {
	player_id: Sequelize.STRING,
	channel_id: Sequelize.BIGINT
})

Channel.sync()
TrackedPlayers.sync()

var Discord = require("discord.js");
var cheerio = require('cheerio')
var mybot = new Discord.Client();
var request = require('request');
var CronJob = require('cron').CronJob;


var confirmationFlags = {}

mybot.on("message", function(message) {
	// should really convert all this shit over to regexes....
	messageContents = message.cleanContent
	let messageRegex = messageContents.match(/([\w@#-]+)+/gm)
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator
	let toMe;
	if (messageRegex[0] == me) {
		toMe = true;
	} else {
		toMe = false;
	}

	if (toMe) {
		let command = messageRegex[1];

		// TODO: check and see if the channel has been set up

		switch (command) {
			case "setup":
				setupChannel(message.channel.id, message)
				break;
			case "stop":
				stopPostingToChannel(message.channel.id, message);
				break;
			case "confirm":
				confirm(message.channel.id, message)
				break;
			case "track":
				playersToTrack = messageRegex.slice(2)
				if (playersToTrack.length == 0) {
					mybot.sendMessage(message, "Ya gotta specify something to track, numbnuts! Try something like `@statsbot track battletag#1234`");
				} else {
					for (player of playersToTrack) {
						startTrackingPlayer(message.channel.id, player, message)
					}
				}
				break;
			case "remove":
				playersToRemove = messageRegex.slice(2)
				if (playersToRemove.length == 0) {
					mybot.sendMessage(message, "Ya gotta specify something to remove, numbnuts! Try something like `@statsbot remove battletag#1234`");
				} else {
					for (player of playersToRemove) {
						stopTrackingPlayer(message.channel.id, player, message)
					}
				}
				break;
			case "list":
				listPlayers(message.channel.id, message)
				break;
			case "post":
				postToChannel(message.channel.id, message)
				break;
			default:
				commands = ["@statsbot setup", "@statsbot post", "@statsbot track battlenetid#1234", "@statsbot remove battlenetid#1234", "@statsbot stop"]
				mybot.sendMessage(message, "Er...what? Didn't quite get that. Try one of these commands:\n\n" + commands.join("\n"))
				delete confirmationFlags[message.channel.id]
				console.log("no command");
		}
	}
})

mybot.loginWithToken(process.env.DISCORD_KEY, function(err, token) {
	if (err) {
		console.log(err);
	} else {
		console.log("Successfully logged in to Discord");
	}

});

mybot.autoReconnect = true;

var setupChannel = function(channel_id, message) {
	// check and see if we're already tracking that channel
	Channel.findOne({
		where: {
			channel_id: channel_id
		}
	}).then(function(channel) {
		if (!channel) {
			mybot.sendMessage(message, "Okay! I'll start posting Overwatch ranks into this channel every day at hiiiiigh noon. To start tracking a player, just say `@statsbot track battletag#1234`.")
			Channel.create({
				channel_id: channel_id,
				players: []
			})
		} else {
			mybot.sendMessage(message, "I'm already posting to this channel, numbnuts! If you'd like me to stop posting to this channel, just say `@statsbot stop`.")
		}
	})
}


var stopPostingToChannel = function(channel_id, message) {
	mybot.sendMessage(message, "I can stop posting to this channel, but if you want me to start again, you'll have to re-add all the players manually. Are you sure you want to do this? If so, just say `@statsbot confirm`.")
		// set confirmation flag for channel
	confirmationFlags[message.channel.id] = true
}

var confirm = function(channel_id, message) {
	// check to see if confirmation flag is set
	if (confirmationFlags[message.channel.id] == true) {
		// if so, perform confirmation action
		// remove channel
		Channel.destroy({
			where: {
				channel_id: message.channel.id
			}
		}).then(function() {
			mybot.sendMessage(message, "Alright, I've stopped posting to this channel.")
		})
	} else {
		mybot.sendMessage(message, "Er...what? What am I supposed to be confirming?")
	}
}

var startTrackingPlayer = function(channel_id, player_id, message) {
	Channel.findOne({
		where: {
			channel_id: channel_id
		}
	}).then(function(channel) {
		if (!channel) {
			mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
		} else {
			// first, check to see if player ID is already being tracked in this channel

			if (channel.players.indexOf(player_id) >= 0) {
				mybot.sendMessage(message, "I'm already tracking " + player_id + " in this channel, numbnuts!")
			} else {
				// if not, tack on the player to the channel, and save
				channel.players.push(player_id)
				channel.update({
					players: channel.players
				}).then(function() {
					mybot.sendMessage(message, "Done! I've added " + player_id + " to the list.")
				})
			}
		}
	})
}

var stopTrackingPlayer = function(channel_id, player_id, message) {
	Channel.findOne({
		where: {
			channel_id: channel_id
		}
	}).then(function(channel) {
		if (!channel) {
			mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
		} else {
			// first, check to see if player ID is already in channel
			// if not, tack on the player to the channel, and save
			if (channel.players.indexOf(player_id) < 0) {
				mybot.sendMessage(message, "I'm not tracking " + player_id + " in this channel, numbnuts!")
			} else {
				channel.players.splice(channel.players.indexOf(player_id), 1)
				channel.update({
					players: channel.players
				}).then(function() {
					mybot.sendMessage(message, "Done! I've removed " + player_id + " from the list.")
				})
			}
		}
	})
}


var listPlayers = function(channel_id, message) {
	Channel.findOne({
		where: {
			channel_id: channel_id
		}
	}).then(function(channel) {
		if (!channel) {
			mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
		} else {
			mybot.sendMessage(message, "I'm currently posting daily ranks for these players in this channel:\n\n" + channel.players.join("\n"))
		}
	})
}

var postToChannel = function(channel_id, message) {
	Channel.findOne({
		where: {
			channel_id: channel_id
		}
	}).then(function(channel) {
		postPlayerRanks(channel.dataValues.channel_id, channel.dataValues.players)
	})
}

var getPlayerRank = function(player_id, cb) {
	var ow_url = "https://playoverwatch.com/en-us/career/pc/us/" + player_id.split("#")[0] + "-" + player_id.split("#")[1]
	request(ow_url, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			$ = cheerio.load(body);
			var competitiveTimePlayed = "0";
			competitiveTimePlayed = $("td:contains('Time Played') ~ td", $("#competitive-play .career-stats-section .js-stats").slice(0, 1)).text()

			var rankElements = $(".competitive-rank")
			if (rankElements.length >= 1) {
				var rank = rankElements.slice(0, 1).text()
			} else {
				rank = ""
			}
			cb(null, {
				player: player_id,
				rank: rank,
				competitiveTimePlayed: competitiveTimePlayed
			})
		} else {
			cb(null, {
				player: player_id,
				rank: "",
				competitiveTimePlayed: ""
			})
		}
	})
}

var postPlayerRanks = function(channel_id, player_ids) {
	console.log("posting ranks for", player_ids, "into", channel_id);
	async.map(player_ids, getPlayerRank, function(err, results) {
		console.log(results);
		results.sort(function(a, b) {
			return b.rank - a.rank
		})
		strings = results.map(function(result) {
			return leftPad(result.player, 20) + " | " + leftPad((result.rank ? result.rank : "-"), 2) + " | " + (result.competitiveTimePlayed ? result.competitiveTimePlayed : "-")
		})
		mybot.sendMessage(channel_id, "**It's hiiiiigh noon.**\n\n```" + strings.join("\n") + "```")
	})
}

var postRanks = function() {
	Channel.findAll().then(function(channels) {
		for (channel of channels) {
			// post player stats to channel
			postPlayerRanks(channel.dataValues.channel_id, channel.dataValues.players)
		}
	})
}

var job = new CronJob('0 0 12 * * *', postRanks, function() {},
	true, "America/Denver"
)

// adding statsbot to a server:
// https://discordapp.com/oauth2/authorize?client_id=200377900413747201&scope=bot&permissions=0
