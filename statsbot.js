var Discord = require("discord.js");
var cheerio = require("cheerio");
var mybot = new Discord.Client();
var request = require("request");
var CronJob = require("cron").CronJob;
var async = require("async");
var leftPad = require("left-pad"); // just cuz
var Sequelize = require("sequelize");

if (process.env.NODE_ENV != "production") {
	require("dotenv").config();
}

var sequelize = new Sequelize(process.env.POSTGRES_URL, {
	dialectOptions: {
		ssl: true
	}
});

var Channel = sequelize.define("channels", {
	channel_id: Sequelize.BIGINT
});

var TrackedPlayer = sequelize.define("tracked_players", {
	player_battletag: Sequelize.STRING,
	channel_id: Sequelize.BIGINT
});

var confirmationFlags = {};

mybot.on("message", function(message) {
	let messageContents = message.cleanContent;
	let messageRegex = messageContents.match(/([\w@#-]+)+/gm);
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	let toMe;
	if (messageRegex[0] == me) {
		toMe = true;
	} else {
		toMe = false;
	}

	let helpCommands = ["@statsbot post", "@statsbot track battlenetid#1234", "@statsbot remove battlenetid#1234", "@statsbot stop"];

	if (toMe) {
		let command = messageRegex[1];

		// TODO: check and see if the channel has been set up

		switch (command) {
			case "stop":
				stopPostingToChannel(message.channel.id, message);
				break;
			case "confirm":
				confirm(message.channel.id, message);
				break;
			case "track":
				let playersToTrack = messageRegex.slice(2);
				if (playersToTrack.length == 0) {
					mybot.sendMessage(message, "Ya gotta specify someone to track, numbnuts! Try something like `@statsbot track battletag#1234`");
				} else {
					for (let player of playersToTrack) {
						startTrackingPlayer(message.channel.id, player, message);
					}
				}
				break;
			case "untrack":
				let playersToRemove = messageRegex.slice(2);
				if (playersToRemove.length == 0) {
					mybot.sendMessage(message, "Ya gotta specify someone to untrack, numbnuts! Try something like `@statsbot untrack battletag#1234`");
				} else {
					for (let player of playersToRemove) {
						stopTrackingPlayer(message.channel.id, player, message);
					}
				}
				break;
			case "list":
				listPlayers(message.channel.id, message);
				break;
			case "post":
				postToChannel(message.channel.id, message);
				break;
			default:
				mybot.sendMessage(message, "Er...what? Didn't quite get that. Try one of these commands:\n\n" + helpCommands.join("\n"));
				delete confirmationFlags[message.channel.id];
		}
	}
});


var stopPostingToChannel = function(channel_id, message) {
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	mybot.sendMessage(message, "I can stop posting to this channel, but if you want me to start again, you'll have to re-add all the players manually. Are you sure you want to do this? If so, say:\n\n`" + me + " confirm`");
	// set confirmation flag for channel
	confirmationFlags[message.channel.id] = true;
};

var confirm = function(channel_id, message) {
	// check to see if confirmation flag is set
	if (confirmationFlags[message.channel.id] == true) {
		// if so, perform confirmation action
		// remove channel
		TrackedPlayer.findAll({
			where: {
				channel_id: message.channel.id
			}
		}).then(function(trackedPlayersInThisChannel) {
			for (let trackedPlayer of trackedPlayersInThisChannel) {
				trackedPlayer.destroy();
			}

			mybot.sendMessage(message, "Alright, I've stopped tracking all players in this channel.");
		});
	} else {
		mybot.sendMessage(message, "Er...what? What am I supposed to be confirming?");
	}
};

var startTrackingPlayer = function(channel_id, player_battletag, message) {
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	TrackedPlayer.find({
		where: {
			channel_id: channel_id,
			player_battletag: player_battletag
		}
	}).then(function(player) {
		if (player) {
			mybot.sendMessage(message, "I'm already tracking " + player_battletag + " in this channel, numbnuts!\n\nIf you want me to stop tracking them, try:\n\n`" + me + " untrack " + player_battletag + "`");
		} else {
			TrackedPlayer.create({
				channel_id: channel_id,
				player_battletag: player_battletag
			}).then(function() {
				// ensure channel exists
				Channel.findOrCreate({
					where: {
						channel_id: channel_id
					}
				}).then(function() {
					mybot.sendMessage(message, "Done! I've started tracking " + player_battletag + " in this channel.");
				});
			});
		}
	});
};

var stopTrackingPlayer = function(channel_id, player_battletag, message) {
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	TrackedPlayer.find({
		where: {
			channel_id: channel_id,
			player_battletag: player_battletag
		}
	}).then(function(player) {
		if (!player) {
			mybot.sendMessage(message, "I'm not tracking " + player_battletag + " in this channel, numbnuts!\n\nIf you want me to start tracking them, try:\n\n`" + me + " track " + player_battletag + "`");
		} else {
			player.destroy().then(function() {
				mybot.sendMessage(message, "Done! I've stopped tracking " + player_battletag + " in this channel.");
			});
		}
	});
};


var listPlayers = function(channel_id, message) {
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	TrackedPlayer.findAll({
		where: {
			channel_id: channel_id
		}
	}).then(function(rawPlayers) {
		let playerBattletags = rawPlayers.map(function(player) {
			return player.get().player_battletag;
		});

		if (playerBattletags.length > 0) {
			mybot.sendMessage(message, "I'm currently posting daily ranks for these players in this channel:\n\n" + playerBattletags.join("\n"));
		} else {
			mybot.sendMessage(message, "I'm not tracking anyone in this channel yet, numbnuts!\n\nStart tracking someone in this channel with:\n\n`" + me + " track battletag#1234`\n\nor\n\n`" + me + " track battletag#1234 anotherbattletag#1234`");
		}
	});
};

var postToChannel = function(channel_id) {
	TrackedPlayer.findAll({
		where: {
			channel_id: channel_id
		}
	}).then(function(rawPlayers) {
		let playerBattletagsToPost = rawPlayers.map(function(rawPlayer) {
			return rawPlayer.get("player_battletag");
		});
		postPlayerRanks(channel_id, playerBattletagsToPost);
	});
};

var getPlayerRank = function(player_id, cb) {
	var ow_url = "https://playoverwatch.com/en-us/career/pc/us/" + player_id.split("#")[0] + "-" + player_id.split("#")[1];
	request(ow_url, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			let $ = cheerio.load(body);
			var competitiveTimePlayed = "0";
			competitiveTimePlayed = $("td:contains('Time Played') ~ td", $("#competitive-play .career-stats-section .js-stats").slice(0, 1)).text();

			var rankElements = $(".competitive-rank");
			if (rankElements.length >= 1) {
				var rank = rankElements.slice(0, 1).text();
			} else {
				rank = "";
			}
			cb(null, {
				player: player_id,
				rank: rank,
				competitiveTimePlayed: competitiveTimePlayed
			});
		} else {
			cb(null, {
				player: player_id,
				rank: "",
				competitiveTimePlayed: ""
			});
		}
	});
};

var postPlayerRanks = function(channel_id, player_ids) {
	async.map(player_ids, getPlayerRank, function(err, results) {
		results.sort(function(a, b) {
			return b.rank - a.rank;
		});
		let strings = results.map(function(result) {
			return leftPad(result.player, 20) + " | " + leftPad((result.rank ? result.rank : "-"), 2);
			//  + " | " + (result.competitiveTimePlayed ? result.competitiveTimePlayed : "-")
		});
		mybot.sendMessage(channel_id, "**It's hiiiiigh noon.**\n\n```" + strings.join("\n") + "```");
	});
};

var postRanks = function() {
	Channel.findAll().then(function(channels) {
		for (let channel of channels) {
			TrackedPlayer.findAll({
				where: {
					channel_id: channel.get("channel_id")
				}
			}).then(function(players) {
				if (players.length > 0) {
					postPlayerRanks(channel.get("channel_id"), players.map(function(player) {
						return player.get("player_battletag");
					}));
				}
			});
		}
	});
};

new CronJob("0 0 12 * * *", postRanks, function() {},
	true, "America/Denver"
);

TrackedPlayer.sync().then(function() {
	Channel.sync().then(function() {
		console.log("Logging into Discord..."); // eslint-disable-line no-console
		mybot.loginWithToken(process.env.DISCORD_KEY, function(err) {
			if (err) {
				console.log(err); // eslint-disable-line no-console
			} else {
				console.log("Successfully logged in to Discord."); // eslint-disable-line no-console
				// postRanks();
			}
		});
	});
});

mybot.autoReconnect = true;
mybot.on("disconnected", function(err) {
	throw "Disconnected! " + err;
});
