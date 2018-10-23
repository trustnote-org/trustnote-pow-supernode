var fs = require('fs');
var util = require('util');

var desktopApp = require('trustnote-pow-common/base/desktop_app.js');

var conf = require('../conf.js');

var appDataDir = desktopApp.getAppDataDir();

function replaceConsoleLog(){
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/log.txt');
	var writeStream = fs.createWriteStream(log_filename);
	console.log('---------------');
	console.log('From this point, output will be redirected to '+log_filename);
	console.log("To release the terminal, type Ctrl-Z, then 'bg'");
	console.log = function(){
		writeStream.write(Date().toString()+': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};
	// console.warn = console.log;
	// console.info = console.log;
}

function replaceConsoleInfo(){
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/info.txt');
	var writeStream = fs.createWriteStream(log_filename);
	console.info = function(){
		console.warn(util.format.apply(null, arguments));
		writeStream.write(Date().toString()+': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};
}

function infoStartMining(miningInput){
	console.info("------------------------Start Mining-------------------------");
	console.info("        My Address: " + my_address);
	console.info("       Round Index: " + miningInput.roundIndex);
	console.info("        Difficulty: " + miningInput.difficulty);	
	console.info("");
}

function infoMiningSuccess(round_index){
	console.info("-----------------------Mining Success------------------------");
	console.info("        My Address: " + my_address);
	console.info("       Round Index: " + round_index);
	console.info("");
}

function infoCoinbaseReward(round_index, coinbaseReward){
	var db = require('trustnote-pow-common/db/db.js')
	if (validationUtils.isValidAddress(my_address))
		db.query("SELECT COUNT(*) AS count FROM my_addresses WHERE address = ?", [my_address], function(rows) {
			if (rows[0].count)
				db.query(
					"SELECT asset, is_stable, SUM(amount) AS balance \n\
					FROM outputs JOIN units USING(unit) \n\
					WHERE is_spent=0 AND address=? AND sequence='good' AND asset IS NULL \n\
					GROUP BY is_stable", [my_address],
					function(rows) {
						var balance = {
							base: {
								stable: 0,
								pending: 0
							}
						};
						for (var i = 0; i < rows.length; i++) {
							var row = rows[i];
							balance.base[row.is_stable ? 'stable' : 'pending'] = row.balance;
						}
						db.query(
							"SELECT SUM(amount) AS coinbasebalance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' \n\
							AND asset IS NULL AND pow_type=?", [my_address, constants.POW_TYPE_COIN_BASE],
							function(rowsCoinbase) {
								if (rowsCoinbase.length ===1 && rowsCoinbase[0].coinbasebalance){
									console.info("-----------------------Coinbase Reward-----------------------");
									console.info("        My Address: " + my_address);
									console.info("       Round Index: " + round_index);
									console.info("   Coinbase Reward: " + coinbaseReward);
									console.info("           Balance: " + JSON.stringify(balance.base));
									console.info("Accumulated Reward: " + rowsCoinbase[0].coinbasebalance);
									console.info("");
								}
								else{
									console.info("-----------------------Coinbase Reward-----------------------");
									console.info(" coinbase reward error: coinbase balance not found");
									console.info("");
								}
							}
						);
						
					}
				);
			else{
				console.info("-----------------------Coinbase Reward-----------------------");
				console.info(" coinbase reward error: address not found");
				console.info("");
			}
		});
	else {
		console.info("-----------------------Coinbase Reward-----------------------");
		console.info(" coinbase reward error: invalid address");
		console.info("");
	}
}


exports.replaceConsoleInfo = replaceConsoleInfo;
exports.replaceConsoleLog = replaceConsoleLog;
exports.infoStartMining = infoStartMining;
exports.infoMiningSuccess = infoMiningSuccess;
exports.infoCoinbaseReward = infoCoinbaseReward;