var Discord = require("discord.js");
var mybot = new Discord.Client();
var request = require("request");
var CronJob = require("cron").CronJob;
var async = require("async");
var leftPad = require("left-pad"); // just cuz
var Sequelize = require("sequelize");
const moment = require("moment");

if (process.env.NODE_ENV != "production") {
	require("dotenv").config();
}

var sequelize = new Sequelize(process.env.POSTGRES_URL, {
	dialectOptions: {
		ssl: true
	}
});

var Channel = sequelize.define("channels", {
	channel_id: {
		type: Sequelize.BIGINT,
		primaryKey: true
	}
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
	if (messageRegex && messageRegex[0] == me) {
		toMe = true;
	} else {
		toMe = false;
	}

	let helpCommands = ["setup", "track battletag#1234", "track battletag#1234 anotherbattletag#1234", "post", "list", "untrack battletag#1234", "untrack battletag#1234 anotherbattletag#1234", "stop"];

	if (toMe) {
		let command = messageRegex[1];

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
					mybot.sendMessage(message, "Ya gotta specify someone to track, numbnuts! Try something like `" + me + " track battletag#1234`");
				} else {
					async.eachSeries(playersToTrack, function(player, cb) {
						startTrackingPlayer(message.channel.id, player, message, cb);
					});
				}
				break;
			case "untrack":
				let playersToRemove = messageRegex.slice(2);
				if (playersToRemove.length == 0) {
					mybot.sendMessage(message, "Ya gotta specify someone to untrack, numbnuts! Try something like `" + me + " untrack battletag#1234`");
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
				mybot.sendMessage(message, "Er...what? Didn't quite get that. Try one of these commands:\n\n```" + helpCommands.join("\n" + me + " ") + "```");
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

var startTrackingPlayer = function(channel_id, player_battletag, message, cb) {
	let me = "@" + message.client.user.username + "#" + message.client.user.discriminator;
	TrackedPlayer.find({
		where: {
			channel_id: channel_id,
			player_battletag: player_battletag
		}
	}).then(function(player) {
		if (player) {
			mybot.sendMessage(message, "I'm already tracking " + player_battletag + " in this channel, numbnuts!\n\nIf you want me to stop tracking them, try:\n\n`" + me + " untrack " + player_battletag + "`");
			cb();
		} else {
			getPlayerRank(player_battletag, function(err, player_stats) {
				if (err) {
					mybot.sendMessage(message, "Hmm...got some kind of error while trying to track " + player_battletag + " in this channel. Try again, and if that doesn't fix it, let us know about the bug! https://github.com/hofftech/statsbot/issues");
					cb();
				} else if (!("rank" in player_stats) || (!player_stats.rank) || (player_stats.rank == "")) {
					mybot.sendMessage(message, "Hm, I can't find a rank for " + player_battletag + " at " + "https://playoverwatch.com/en-us/career/pc/us/" + player_battletag.split("#")[0] + "-" + player_battletag.split("#")[1] + " ! Either \"" + player_battletag + "\" doesn't exist in Overwatch, or they just haven't played enough games to be ranked yet.");
					cb();
				} else {
					TrackedPlayer.create({
						channel_id: channel_id,
						player_battletag: player_battletag
					}).then(function() {
						// ensure channel exists
						// this is where the problem is - if we add 5 players at once, then we add 5 channels at once
						Channel.findOrCreate({
							where: {
								channel_id: channel_id
							}
						}).then(function() {
							mybot.sendMessage(message, "Done! I've started tracking " + player_battletag + " in this channel.");
							cb();
						});
					});
				}
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
	request("https://overwatch-stats-api.com/players/" + encodeURIComponent(player_id), function(error, response, body) {
		if (!error && response.statusCode == 200) {
			body = JSON.parse(body);
			calculateLastTimePlayed(body, function(lastTimePlayed) {
				if ("rank" in body) {
					cb(null, {
						player: player_id,
						rank: body.rank,
						lastPlayedCompetitive: humanizeLastTimePlayed(lastTimePlayed)
					});
				} else {
					cb(null, {
						player: player_id,
						rank: "",
						lastPlayedCompetitive: humanizeLastTimePlayed(lastTimePlayed)
					});
				}
			});
		} else {
			cb(null, {
				player: player_id,
				rank: ""
			});
		}
	});
};


// returns the last time that a player has played, in milliseconds since epoch
var calculateLastTimePlayed = function(player_data, cb) {
	if (player_data.history.length == 0) {
		return cb(null, moment(player_data.timestamp).valueOf());
	}
	if (player_data.history.length == 1) {
		return cb(null, moment(player_data.history[0].timestamp).valueOf());
	}
	var mostRecentRank = player_data.rank;
	for (var i = 0; i < player_data.history.length; i++) {
		if (player_data.history[i].rank != mostRecentRank) {
			let lastTimePlayed = player_data.history[i - 1].timestamp;
			let converted = moment(lastTimePlayed).valueOf();
			return cb(converted);
		}
	}
	return cb(moment(player_data.history[player_data.history.length - 1].timestamp).valueOf());
};

// takes the last time played (in milliseconds since epoch) and returns a string with # of days ago
var humanizeLastTimePlayed = function(lastTimePlayed) {
	var duration = moment(new Date()).valueOf() - moment(lastTimePlayed).valueOf();
	return "about " + moment.duration(duration).humanize() + " ago";
};

var postPlayerRanks = function(channel_id, player_ids) {
	async.map(player_ids, getPlayerRank, function(err, results) {
		results.sort(function(a, b) {
			return b.rank - a.rank;
		});
		let strings = results.map(function(result) {
			return leftPad(result.player, 20) + " | " + leftPad((result.rank ? result.rank : "-"), 2) + " | " + (result.lastPlayedCompetitive ? result.lastPlayedCompetitive : "-");
		});
		mybot.sendMessage(channel_id, "**It's hiiiiigh noon.**\n\n```" + leftPad("Player", 20) + " | Rank | Last Played (Competitive)" + "\n" + "-------------------- | ---- | -------------------------" + "\n" + strings.join("\n") + "```");
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
				throw err;
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
