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

Channel.sync()

var Discord = require("discord.js");
var cheerio = require('cheerio')
var mybot = new Discord.Client();
var request = require('request');
var CronJob = require('cron').CronJob;


var confirmationFlags = {}

mybot.on("message", function(message) {
	// should really convert all this shit over to regexes....
	if (message.cleanContent.startsWith("@statsbot#7636") || message.cleanContent.startsWith("@statsbot-dev#7142")) {
		// hey! that's to statsbot!
		messageContents = message.cleanContent
		if (messageContents.indexOf("setup") >= 0) {
			// check and see if we're already tracking that channel
			Channel.findOne({
				where: {
					channel_id: message.channel.id
				}
			}).then(function(channel) {
				if (!channel) {
					mybot.sendMessage(message, "Okay! I'll start posting Overwatch ranks into this channel every day at hiiiiigh noon. To start tracking a player, just say `@statsbot track battlenetid#1234`.")
					Channel.create({
						channel_id: message.channel.id,
						players: []
					})
				} else {
					mybot.sendMessage(message, "I'm already posting to this channel, numbnuts! If you'd like me to stop posting to this channel, just say `@statsbot stop`.")
				}
			})
		} else if (messageContents.indexOf("stop") >= 0) {
			mybot.sendMessage(message, "I can stop posting to this channel, but if you want me to start again, you'll have to re-add all the players manually. Are you sure you want to do this? If so, just say `@statsbot confirm`.")
				// set confirmation flag for channel
			confirmationFlags[message.channel.id] = true
		} else if (messageContents.indexOf("confirm") >= 0) {
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
		} else if (messageContents.indexOf("track") >= 0) {
			re = messageContents.match(/(.*) (\w*) (.*)/)
			if (!re) {
				mybot.sendMessage(message, "Ya gotta specify something to track, numbnuts! Try something like `@statsbot track mybattletag#1234`");
			} else {
				var player = re[3];
				// append player to list on channel
				Channel.findOne({
					where: {
						channel_id: message.channel.id
					}
				}).then(function(channel) {
					if (!channel) {
						mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
					} else {
						// first, check to see if player ID is already in channel

						if (channel.players.indexOf(player) >= 0) {
							mybot.sendMessage(message, "I'm already tracking " + player + " in this channel, numbnuts!")
						} else {
							// if not, tack on the player to the channel, and save
							channel.players.push(player)
							channel.update({
								players: channel.players
							}).then(function() {
								mybot.sendMessage(message, "Done! I've added " + player + " to the list.")
							})
						}
					}
				})
			}
		} else if (messageContents.indexOf("remove") >= 0) {
			re = messageContents.match(/@statsbot#7636 (\w*) (.*)/)
			console.log(re);
			var player = re[2];
			// append player to list on channel
			Channel.findOne({
				where: {
					channel_id: message.channel.id
				}
			}).then(function(channel) {
				if (!channel) {
					mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
				} else {
					// first, check to see if player ID is already in channel
					// if not, tack on the player to the channel, and save
					if (channel.players.indexOf(player) < 0) {
						mybot.sendMessage(message, "I'm not tracking " + player + " in this channel, numbnuts!")
					} else {
						channel.players.splice(channel.players.indexOf(player), 1)
						channel.update({
							players: channel.players
						}).then(function() {
							mybot.sendMessage(message, "Done! I've removed " + player + " from the list.")
						})
					}
				}
			})
		} else if (messageContents.indexOf("list") >= 0) {
			Channel.findOne({
				where: {
					channel_id: message.channel.id
				}
			}).then(function(channel) {
				if (!channel) {
					mybot.sendMessage(message, "Whoa, hold on there! You need to run `@statsbot setup` for this channel first.")
				} else {
					mybot.sendMessage(message, "I'm currently posting daily ranks for these players in this channel:\n\n" + channel.players.join("\n"))
				}
			})
		} else if (messageContents.indexOf("post") >= 0) {
			Channel.findOne({
				where: {
					channel_id: message.channel.id
				}
			}).then(function(channel) {
				postPlayerRanks(channel.dataValues.channel_id, channel.dataValues.players)
			})
		} else {
			commands = ["@statsbot setup", "@statsbot post", "@statsbot track battlenetid#1234", "@statsbot remove battlenetid#1234", "@statsbot stop"]
			mybot.sendMessage(message, "Er...what? Didn't quite get that. Try one of these commands:\n\n" + commands.join("\n"))
			delete confirmationFlags[message.channel.id]
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
