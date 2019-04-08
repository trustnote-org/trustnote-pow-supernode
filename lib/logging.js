/*jslint node: true */
"use strict";
var fs = require('fs');
var util = require('util');

var desktopApp = require('trustnote-pow-common/base/desktop_app.js');
var validationUtils = require("trustnote-pow-common/validation/validation_utils.js");
var constants = require("trustnote-pow-common/config/constants.js");
var db = require('trustnote-pow-common/db/db.js');

var conf = require('../conf.js');
var appDataDir = desktopApp.getAppDataDir();

/**
 * repalce console.log, will write all output into log file
 */
function replaceConsoleLog(){
	var supernode = require('trustnote-pow-common/wallet/supernode');
	supernode.readSingleAddress(db, function(address){

		var log_filename = conf.LOG_FILENAME || (appDataDir + '/log.txt');
		var writeStream = fs.createWriteStream(log_filename);
		console.log('---------------');
		console.log('From this point, output will be redirected to '+log_filename);
		console.log("To release the terminal, type Ctrl-Z, then 'bg'");
		console.log("my address: " + address);
		console.log = function(){
			writeStream.write(Date().toString()+': ');
			writeStream.write(util.format.apply(null, arguments) + '\n');
		};
		// console.warn = console.log;
		// console.info = console.log;
	});
}

/**
 * repalce console.info, will write all output into info file
 */
function replaceConsoleInfo(){
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/info.txt');
	var writeStream = fs.createWriteStream(log_filename);
	console.info = function(){
		console.warn(util.format.apply(null, arguments));
		writeStream.write(Date().toString()+': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};	
}

/**
 * print all mining result with console.info
 * @param {Object} miningInput - mining result
 */
function infoStartMining(miningInput){
	console.info("----------------Start Mining:"+new Date().toLocaleString()+"-----------------");
	console.info("       Round Index: " + miningInput.roundIndex);
	console.info("              Bits: " + miningInput.bits);	
	console.info("");
}

/**
 * print all round information with console.info
 * @param {Number} round_index 
 */
function infoMiningSuccess(round_index){
	console.info("---------------Mining Success:"+new Date().toLocaleString()+"----------------");
	console.info("       Round Index: " + round_index);
	console.info("");
}

/**
 * print all coinbase result with console.info
 * @param {Number} round_index - current round index
 * @param {Number} coinbaseReward - coinbase reward
 */
function infoCoinbaseReward(round_index, my_address, coinbaseReward){
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
						var address = conf.coinbase_address ? conf.coinbase_address : my_address
						db.query(
							"SELECT SUM(amount) AS coinbasebalance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' \n\
							AND asset IS NULL AND pow_type=?", [address, constants.POW_TYPE_COIN_BASE],
							function(rowsCoinbase) {
								if (rowsCoinbase.length ===1 && rowsCoinbase[0].coinbasebalance){
									console.info("---------------Coinbase Reward:"+new Date().toLocaleString()+"---------------");
									console.info("  Coinbase Address: " + address);
									console.info("       Round Index: " + round_index);
									console.info("   Coinbase Reward: " + coinbaseReward);
									console.info(" Supernode Balance: " + JSON.stringify(balance.base));
									console.info("Accumulated Reward: " + rowsCoinbase[0].coinbasebalance);
									console.info("");
								}
								else{
									console.info("---------------Coinbase Reward:"+new Date().toLocaleString()+"---------------");
									console.info(" coinbase reward error: coinbase balance not found");
									console.info("");
								}
							}
						);
						
					}
				);
			else{
				console.info("---------------Coinbase Reward:"+new Date().toLocaleString()+"---------------");
				console.info(" coinbase reward error: address not found");
				console.info("");
			}
		});
	else {
		console.info("---------------Coinbase Reward:"+new Date().toLocaleString()+"---------------");
		console.info(" coinbase reward error: invalid address");
		console.info("");
	}
}

/**
 * exports
 */
exports.replaceConsoleInfo = replaceConsoleInfo;
exports.replaceConsoleLog = replaceConsoleLog;
exports.infoStartMining = infoStartMining;
exports.infoMiningSuccess = infoMiningSuccess;
exports.infoCoinbaseReward = infoCoinbaseReward;
