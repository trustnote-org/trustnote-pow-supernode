/*jslint node: true */
"use strict";
var fs = require('fs');
var crypto = require('crypto');
var util = require('util');
var constants = require('trustnote-pow-common/constants.js');
var conf = require('trustnote-pow-common/conf.js');
var objectHash = require('trustnote-pow-common/object_hash.js');
var desktopApp = require('trustnote-pow-common/desktop_app.js');
var db = require('trustnote-pow-common/db.js');
var eventBus = require('trustnote-pow-common/event_bus.js');
var ecdsaSig = require('trustnote-pow-common/signature.js');
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');
var readline = require('readline');

require('./relay.js');
var push = require('./push.js');
var storage;
var mail = require('trustnote-pow-common/mail.js');
var round = require('trustnote-pow-common/round.js');
var pow = require('trustnote-pow-common/pow.js');
var validationUtils = require("trustnote-pow-common/validation_utils.js");

if (!conf.bSingleAddress)
	throw Error('witness must be single address');

var WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var bWitnessingUnderWay = false;
var forcedWitnessingTimer;
var count_witnessings_available = 0;

var appDataDir = desktopApp.getAppDataDir();
var KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');
var wallet_id;
var xPrivKey;
var MIN_INTERVAL = conf.MIN_INTERVAL || 60 * 1000;

function datetime() {
	let date = new Date();
	return ''+ date.getFullYear() + (date.getMonth() < 10 ? '0' :'') + date.getMonth() +
	(date.getDate() < 10 ? '0' :'') + date.getDate() + (date.getHours() < 10 ? '0' :'') + date.getHours() +
	(date.getMinutes() < 10 ? '0' :'') + date.getMinutes() + ( date.getSeconds() < 10 ? '0' :'') + date.getSeconds()
}

function replaceConsoleLog(){
	// var log_filename = conf.LOG_FILENAME || (appDataDir + '/log'+ datetime() +'.txt');
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/log.txt');
	var writeStream = fs.createWriteStream(log_filename);
	console.log('---------------');
	console.log('From this point, output will be redirected to '+log_filename);
	console.log("To release the terminal, type Ctrl-Z, then 'bg'");
	console.log = function(){
		writeStream.write(Date().toString()+': ');
		writeStream.write(util.format.apply(null, arguments) + '\n');
	};
	console.warn = console.log;
	console.info = console.log;
}

// pow add
var bMining = false; // if miner is mining
var bPowSent = false; // if pow joint is sent
var currentRound = 1; // to record current round index

function onError(err){
	// throw Error(err);
	console.log("Error: " + err);
}

function onMiningError(err){
	// throw Error(err);
	bMining = false;
	console.log("Mining Error: " + err);
}

function readKeys(onDone){
	console.log('-----------------------');
	if (conf.control_addresses)
		console.log("remote access allowed from devices: "+conf.control_addresses.join(', '));
	if (conf.payout_address)
		console.log("payouts allowed to address: "+conf.payout_address);
	console.log('-----------------------');
	fs.readFile(KEYS_FILENAME, 'utf8', function(err, data){
		var rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			//terminal: true
		});
		if (err){ // first start
			console.log('failed to read keys, will gen');
			var suggestedDeviceName = require('os').hostname() || 'Headless';
			rl.question("Please name this device ["+suggestedDeviceName+"]: ", function(deviceName){
				if (!deviceName)
					deviceName = suggestedDeviceName;
				var userConfFile = appDataDir + '/conf.json';
				fs.writeFile(userConfFile, JSON.stringify({deviceName: deviceName, admin_email: "admin@example.com", from_email: "noreply@example.com"}, null, '\t'), 'utf8', function(err){
					if (err)
						throw Error('failed to write conf.json: '+err);
					rl.question(
						'Device name saved to '+userConfFile+', you can edit it later if you like.\n\nPassphrase for your private keys: ',
						function(passphrase){
							rl.close();
							if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
							if (process.stdout.clearLine)  process.stdout.clearLine();
							var deviceTempPrivKey = crypto.randomBytes(32);
							var devicePrevTempPrivKey = crypto.randomBytes(32);

							var mnemonic = new Mnemonic(); // generates new mnemonic
							while (!Mnemonic.isValid(mnemonic.toString()))
								mnemonic = new Mnemonic();

							writeKeys(mnemonic.phrase, deviceTempPrivKey, devicePrevTempPrivKey, function(){
								console.log('keys created');
								var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
								createWallet(xPrivKey, function(){
									onDone(mnemonic.phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
								});
							});
						}
					);
				});
			});
		}
		else{ // 2nd or later start
			rl.question("Passphrase: ", function(passphrase){
				var passphrase = "";
				rl.close();
				if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
				if (process.stdout.clearLine)  process.stdout.clearLine();
				var keys = JSON.parse(data);
				var deviceTempPrivKey = Buffer(keys.temp_priv_key, 'base64');
				var devicePrevTempPrivKey = Buffer(keys.prev_temp_priv_key, 'base64');
				determineIfWalletExists(function(bWalletExists){
					if (bWalletExists)
						onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
					else{
						var mnemonic = new Mnemonic(keys.mnemonic_phrase);
						var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
						createWallet(xPrivKey, function(){
							onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
						});
					}
				});
			});
		}
	});
}

function writeKeys(mnemonic_phrase, deviceTempPrivKey, devicePrevTempPrivKey, onDone){
	var keys = {
		mnemonic_phrase: mnemonic_phrase,
		temp_priv_key: deviceTempPrivKey.toString('base64'),
		prev_temp_priv_key: devicePrevTempPrivKey.toString('base64')
	};
	fs.writeFile(KEYS_FILENAME, JSON.stringify(keys, null, '\t'), 'utf8', function(err){
		if (err)
			throw Error("failed to write keys file");
		if (onDone)
			onDone();
	});
}

function createWallet(xPrivKey, onDone){
	var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
	var device = require('trustnote-pow-common/device.js');
	device.setDevicePrivateKey(devicePrivKey); // we need device address before creating a wallet
	var strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
	var walletDefinedByKeys = require('trustnote-pow-common/wallet_defined_by_keys.js');
	walletDefinedByKeys.createWalletByDevices(strXPubKey, 0, 1, [], 'any walletName', function(wallet_id){
		walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo){
			onDone();
		});
	});
}

function isControlAddress(device_address){
	return (conf.control_addresses && conf.control_addresses.indexOf(device_address) >= 0);
}

function readSingleAddress(handleAddress){
	db.query("SELECT address FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address);
	});
}

function prepareBalanceText(handleBalanceText){
	var Wallet = require('trustnote-pow-common/wallet.js');
	Wallet.readBalance(wallet_id, function(assocBalances){
		var arrLines = [];
		for (var asset in assocBalances){
			var total = assocBalances[asset].stable + assocBalances[asset].pending;
			var units = (asset === 'base') ? ' bytes' : (' of ' + asset);
			var line = total + units;
			if (assocBalances[asset].pending)
				line += ' (' + assocBalances[asset].pending + ' pending)';
			arrLines.push(line);
		}
		handleBalanceText(arrLines.join("\n"));
	});
}

function readSingleWallet(handleWallet){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleWallet(rows[0].wallet);
	});
}

function determineIfWalletExists(handleResult){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleResult(rows.length > 0);
	});
}

function signWithLocalPrivateKey(wallet_id, account, is_change, address_index, text_to_sign, handleSig){
	var path = "m/44'/0'/" + account + "'/"+is_change+"/"+address_index;
	var privateKey = xPrivKey.derive(path).privateKey;
	var privKeyBuf = privateKey.bn.toBuffer({size:32}); // https://github.com/bitpay/bitcore-lib/issues/47
	handleSig(ecdsaSig.sign(text_to_sign, privKeyBuf));
}

var signer = {
	readSigningPaths: function(conn, address, handleLengthsBySigningPaths){
		handleLengthsBySigningPaths({r: constants.SIG_LENGTH});
	},
	readDefinition: function(conn, address, handleDefinition){
		conn.query("SELECT definition FROM my_addresses WHERE address=?", [address], function(rows){
			if (rows.length !== 1)
				throw "definition not found";
			handleDefinition(null, JSON.parse(rows[0].definition));
		});
	},
	sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
		var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
		db.query(
			"SELECT wallet, account, is_change, address_index \n\
			FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
			WHERE address=? AND signing_path=?",
			[address, signing_path],
			function(rows){
				if (rows.length !== 1)
					throw Error(rows.length+" indexes for address "+address+" and signing path "+signing_path);
				var row = rows[0];
				signWithLocalPrivateKey(row.wallet, row.account, row.is_change, row.address_index, buf_to_sign, function(sig){
					handleSignature(null, sig);
				});
			}
		);
	}
};

function handlePairing(from_address){
	var device = require('trustnote-pow-common/device.js');
	prepareBalanceText(function(balance_text){
		device.sendMessageToDevice(from_address, 'text', balance_text);
	});
}

function handleText(from_address, text){

	text = text.trim();
	var fields = text.split(/ /);
	var command = fields[0].trim().toLowerCase();
	var params =['',''];
	if (fields.length > 1) params[0] = fields[1].trim();
	if (fields.length > 2) params[1] = fields[2].trim();

	var device = require('trustnote-pow-common/device.js');
	switch(command){
		case 'address':
			readSingleAddress(function(address){
				device.sendMessageToDevice(from_address, 'text', address);
			});
			break;

		case 'balance':
			prepareBalanceText(function(balance_text){
				device.sendMessageToDevice(from_address, 'text', balance_text);
			});
			break;

		default:
				return device.sendMessageToDevice(from_address, 'text', "unrecognized command");
	}
}


// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys

function setupChatEventHandlers(){
	eventBus.on('paired', function(from_address){
		console.log('paired '+from_address);
		if (!isControlAddress(from_address))
			return console.log('ignoring pairing from non-control address');
		handlePairing(from_address);
	});

	eventBus.on('text', function(from_address, text){
		console.log('text from '+from_address+': '+text);
		if (!isControlAddress(from_address))
			return console.log('ignoring text from non-control address');
		handleText(from_address, text);
	});
}

function notifyAdmin(subject, body){
	mail.sendmail({
		to: conf.admin_email,
		from: conf.from_email,
		subject: subject,
		body: body
	});
}

function notifyAdminAboutFailedWitnessing(err){
	console.log('witnessing failed: '+err);
	notifyAdmin('witnessing failed: '+err, err);
}

function notifyAdminAboutWitnessingProblem(err){
	console.log('witnessing problem: '+err);
	notifyAdmin('witnessing problem: '+err, err);
}


function witness(onDone){
	function onError(err){
		// notifyAdminAboutFailedWitnessing(err);
		setTimeout(onDone, 60000); // pause after error
	}
	var network = require('trustnote-pow-common/network.js');
	var composer = require('trustnote-pow-common/composer.js');
	if (!network.isConnected()){
		console.log('not connected, skipping');
		return onDone();
	}

	const callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			onDone();
		}
	})
	db.takeConnectionFromPool(function(conn){
		round.getCurrentRoundIndex(conn, function(round_index){
			determineIfIAmWitness(conn, round_index, function(bWitness){
				conn.release()
				if(!bWitness) {
					bWitnessingUnderWay = false;
					return console.log('I am not an attestor for now')
				}
				createOptimalOutputs(function(arrOutputs){
					if (conf.bPostTimestamp) {
						var params = {
							paying_addresses: [my_address],
							outputs: arrOutputs,
							pow_type: constants.POW_TYPE_TRUSTME,
							round_index: round_index,
							signer: signer,
							callbacks: callbacks
						}
						var timestamp = Date.now();
						var datafeed = {timestamp: timestamp};
						var objMessage = {
							app: "data_feed",
							payload_location: "inline",
							payload_hash: objectHash.getBase64Hash(datafeed),
							payload: datafeed
						};
						params.messages = [objMessage];
						return composer.composeJoint(params);
					}
					composer.composeTrustMEJoint(my_address, round_index, signer, callbacks);
				});
			})
		})
	})
}


function checkAndWitness(){
	console.log('checkAndWitness');
	clearTimeout(forcedWitnessingTimer);
	if (bWitnessingUnderWay)
		return console.log('witnessing under way');
	bWitnessingUnderWay = true;
	// abort if there are my units without an mci
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return console.log('my units without mci');
		}
		// pow add
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				determineIfIAmWitness(conn, round_index, function(bWitness){
					conn.release()
					// pow add
					console.log('CheckIfIamWitnessRound:'+round_index)
					if (!bWitness){
						bWitnessingUnderWay = false;
						return console.log('I am not an attestor for now')
					}
					storage.readLastMainChainIndex(function(max_mci){
						let col = (conf.storage === 'mysql') ? 'main_chain_index' : 'unit_authors.rowid';
						db.query(
							"SELECT main_chain_index AS max_my_mci, "+db.getUnixTimestamp('creation_date')+" AS last_ts \n\
							FROM units JOIN unit_authors USING(unit) WHERE +address=? ORDER BY "+col+" DESC LIMIT 1", 
							[my_address],
							function(rows){
								var max_my_mci = (rows.length > 0) ? rows[0].max_my_mci : -1000;
								var distance = max_mci - max_my_mci;
								console.log("distance="+distance+", interval="+(interval/1000)+"s");
								if (distance > conf.THRESHOLD_DISTANCE){
									console.log('distance above threshold, will witness');
									setTimeout(function(){
										witness(function(){
											bWitnessingUnderWay = false;
										});
									}, Math.round(Math.random()*3000));
								} else {
									bWitnessingUnderWay = false;
									checkForUnconfirmedUnits(conf.THRESHOLD_DISTANCE - distance);
								}
							}
						);
					});
					// setTimeout(function(){
					// 	witness(function(){
					// 		console.log('witnessing is over');
					// 		bWitnessingUnderWay = false;
					// 	});
					// }, Math.round(Math.random()*3000));
				});
			})
		})
	});
}

// pow add
function determineIfIAmWitness(conn, round_index, handleResult){
	round.getWitnessesByRoundIndex(conn, round_index, function(arrWitnesses){
		conn.query(
			"SELECT 1 FROM my_addresses where address IN(?)", [arrWitnesses], function(rows) {
				if(rows.length===0) {
					return handleResult(false)
				}
				return handleResult(true)
			}
		)
	})
}

function determineIfThereAreMyUnitsWithoutMci(handleResult){
	db.query("SELECT 1 FROM units JOIN unit_authors USING(unit) WHERE address=? AND main_chain_index IS NULL LIMIT 1", [my_address], function(rows){
		handleResult(rows.length > 0);
	});
}

function checkForUnconfirmedUnits(distance_to_threshold){
	db.query( // look for unstable non-witness-authored units
		// pow modi
		"SELECT 1 FROM units CROSS JOIN unit_authors USING(unit)\n\
		WHERE (main_chain_index>? OR main_chain_index IS NULL AND sequence='good') \n\
			AND NOT ( \n\
				(SELECT COUNT(*) FROM messages WHERE messages.unit=units.unit)=1 \n\
				AND (SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit)=1 \n\
				AND (SELECT COUNT(DISTINCT address) FROM outputs WHERE outputs.unit=units.unit)=1 \n\
				AND (SELECT address FROM outputs WHERE outputs.unit=units.unit LIMIT 1)=unit_authors.address \n\
			) \n\
		LIMIT 1",
		[storage.getMinRetrievableMci()], // light clients see all retrievable as unconfirmed
		function(rows){
			if (rows.length === 0)
				return;
			var timeout = Math.round((distance_to_threshold + Math.random())*10000);
			console.log('scheduling unconditional witnessing in '+timeout+' ms unless a new unit arrives');
			forcedWitnessingTimer = setTimeout(witnessBeforeThreshold, timeout);
		}
	);
}

//add winess payment victor
// function checkForUnconfirmedUnitsAndWitness(distance_to_threshold){
// 	db.query( // look for unstable non-witness-authored units 
// 		// pow modi
// 		"SELECT 1 FROM units CROSS JOIN unit_authors USING(unit)\n\
// 		WHERE (main_chain_index>? OR main_chain_index IS NULL AND sequence='good') \n\
// 			AND NOT ( \n\
// 				(SELECT COUNT(*) FROM messages WHERE messages.unit=units.unit)=1 \n\
// 				AND (SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit)=1 \n\
// 				AND (SELECT COUNT(DISTINCT address) FROM outputs WHERE outputs.unit=units.unit)=1 \n\
// 				AND (SELECT address FROM outputs WHERE outputs.unit=units.unit LIMIT 1)=unit_authors.address \n\
// 			) \n\
// 		LIMIT 1",
// 		[storage.getMinRetrievableMci()], // light clients see all retrievable as unconfirmed
// 		function(rows){
// 			if (rows.length === 0)
// 				return;
// 			var timeout = Math.round((distance_to_threshold + Math.random())*1000);
// 			console.log('scheduling unconditional witnessing in '+timeout+' ms unless a new unit arrives');
// 			forcedWitnessingTimer = setTimeout(witnessBeforeThreshold, timeout);
// 		}
// 	);
// }

function witnessBeforeThreshold(){
	if (bWitnessingUnderWay)
		return;
	bWitnessingUnderWay = true;
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return console.log('my units without mci');
		}
		// pow add
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				determineIfIAmWitness(conn, round_index, function(bWitness){
					conn.release()
					// pow add
					if (!bWitness){
						bWitnessingUnderWay = false;
						return console.log('I am not an attestor for now')
					}
					console.log('will witness before threshold');
					witness(function(){
						bWitnessingUnderWay = false;
					});
				});
			});
		})	
	});
}

function readNumberOfWitnessingsAvailable(handleNumber){
	count_witnessings_available--;
	if (count_witnessings_available > conf.MIN_AVAILABLE_WITNESSINGS)
		return handleNumber(count_witnessings_available);
	db.query(
		"SELECT COUNT(*) AS count_big_outputs FROM outputs JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0",
		[my_address, WITNESSING_COST],
		function(rows){
			var count_big_outputs = rows[0].count_big_outputs;
			db.query(
				"SELECT SUM(amount) AS total FROM outputs JOIN units USING(unit) \n\
				WHERE address=? AND is_stable=1 AND amount<? AND asset IS NULL AND is_spent=0",
				[my_address, WITNESSING_COST],
				function(rows){
					var total = rows.reduce(function(prev, row){ return (prev + row.total); }, 0);
					var count_witnessings_paid_by_small_outputs_and_commissions = Math.round(total / WITNESSING_COST);
					count_witnessings_available = count_big_outputs + count_witnessings_paid_by_small_outputs_and_commissions;
					handleNumber(count_witnessings_available);
				}
			);
		}
	);
}

// make sure we never run out of spendable (stable) outputs. Keep the number above a threshold, and if it drops below, produce more outputs than consume.
function createOptimalOutputs(handleOutputs){
	var arrOutputs = [{amount: 0, address: my_address}];
	readNumberOfWitnessingsAvailable(function(count){
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs(arrOutputs);
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1",
			[my_address, 2*WITNESSING_COST],
			function(rows){
				if (rows.length === 0){
					// notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, and can't add more");
					return handleOutputs(arrOutputs);
				}
				var amount = rows[0].amount;
				// notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({amount: Math.round(amount/2), address: my_address});
				handleOutputs(arrOutputs);
			}
		);
	});
}

// function notifyMinerStartMining() {
// 	db.takeConnectionFromPool(function(conn){
// 		round.getCurrentRoundIndex(conn, function(round_index){
// 			console.log('===Will start mining===')
// 			pow.startMining(conn, round_index,function(err) {
// 				if (err) {
// 					// notifyAdminAboutWitnessingProblem(err)
// 					conn.release()
// 					setTimeout(notifyMinerStartMining, 10*1000);
// 				}
// 				else {
// 					conn.release();
// 				}
// 			})
// 		})
// 	});
// }

function checkTrustMEAndStartMinig(round_index){
	if(conf.start_mining_round > round_index) {
		return console.log("Current round is to early, will not be mining")
	}
	bMining = true;
	db.takeConnectionFromPool(function(conn){
		conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
		[round_index, constants.POW_TYPE_TRUSTME], function(rows){
			if(rows.length>=1){
				pow.obtainMiningInput(conn, round_index, function(err, input_object) {
					conn.release();
					if (err) {
						// notifyAdminAboutWitnessingProblem(err)
						console.log("Mining Error:" + err);
						bMining = false;
					}
					else {
						pow.startMiningWithInputs(input_object, function(err){
							if (err) {
								console.log("Mining Error:" + err);
							} else {
								console.log("Mining Succeed");
							}
							bMining = false;
						})
					}
				})
			}
			else {
				bMining = false;
				conn.release();
			}
		})
	})
}

function checkRoundAndComposeCoinbase(round_index) {
	var network = require('trustnote-pow-common/network.js');
	var composer = require('trustnote-pow-common/composer.js');

	const callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			console.log('=== Coinbase sent ===')
		}
	})
	
	console.log('Going to compose Coinbase')
	db.takeConnectionFromPool(function(conn){
		if(round_index===1) {
			conn.release();
			return
		}
		determineIfIAmWitness(conn, round_index-1, function(bWitness){
			if(bWitness) {
				conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
				[round_index, constants.POW_TYPE_TRUSTME], function(rows){
					if(rows.length >= 1) {
						conn.query("select 1 from units join unit_authors using(unit) where address=? and pow_type=? and round_index=?",
						[my_address, constants.POW_TYPE_COIN_BASE, round_index], function(rows){
							if(rows.length<=0){
								round.getCoinbaseByRoundIndexAndAddress(conn, round_index-1, my_address, function(coinbase_amount){
									conn.release();
									if(coinbase_amount===0){
										return console.log("No coinbase earned")
									}
									composer.composeCoinbaseJoint(my_address, round_index, coinbase_amount, signer, callbacks);
								})
							} else {
								conn.release();
							}
						})
					} else {
						conn.release();
					}
				})
			} else {
				conn.release();
			}
		});
	})
}

setTimeout(function(){
	readKeys(function(mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey){
		var saveTempKeys = function(new_temp_key, new_prev_temp_key, onDone){
			writeKeys(mnemonic_phrase, new_temp_key, new_prev_temp_key, onDone);
		};
		var mnemonic = new Mnemonic(mnemonic_phrase);
		// global
		xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
		// read the id of the only wallet
		readSingleWallet(function(wallet){
			// global
			wallet_id = wallet;
			var device = require('trustnote-pow-common/device.js');
			device.setDevicePrivateKey(devicePrivKey);
			let my_device_address = device.getMyDeviceAddress();
			db.query("SELECT 1 FROM extended_pubkeys WHERE device_address=?", [my_device_address], function(rows){
				if (rows.length > 1)
					throw Error("more than 1 extended_pubkey?");
				if (rows.length === 0)
					return setTimeout(function(){
						console.log('passphrase is incorrect');
						process.exit(0);
					}, 1000);
				require('trustnote-pow-common/wallet.js'); // we don't need any of its functions but it listens for hub/* messages
				// device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
				// device.setDeviceName(conf.deviceName);
				// device.setDeviceHub(conf.hub);
				// let my_device_pubkey = device.getMyDevicePubKey();
				// console.log("====== my device address: "+my_device_address);
				// console.log("====== my device pubkey: "+my_device_pubkey);
				// if (conf.permanent_pairing_secret)
				// 	console.log("====== my pairing code: "+my_device_pubkey+"@"+conf.hub+"#"+conf.permanent_pairing_secret);
				// if (conf.bLight){
				// 	var light_wallet = require('trustnote-pow-common/light_wallet.js');
				// 	light_wallet.setLightVendorHost(conf.hub);
				// }
				eventBus.emit('headless_wallet_ready');
				setTimeout(replaceConsoleLog, 1000);
			});
		});
	});
}, 1000);

// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys


eventBus.on('headless_wallet_ready', function(){
	var network = require('trustnote-pow-common/network.js');
	var composer = require('trustnote-pow-common/composer.js');
	var storage = require('trustnote-pow-common/storage.js');
	
	if (conf.permanent_pairing_secret)
		db.query(
			"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
			[conf.permanent_pairing_secret]
		);
		
	if (!conf.admin_email || !conf.from_email){
		console.log("please specify admin_email and from_email in your "+desktopApp.getAppDataDir()+'/conf.json');
		process.exit(1);
	}
	setupChatEventHandlers();
	readSingleAddress(function(address){
		my_address = address;
		//checkAndWitness();
		eventBus.on('new_joint', checkAndWitness); // new_joint event is not sent while we are catching up
	});
	
	eventBus.on('round_switch', function(round_index){
		bMining = false;
		bPowSent = false;
		pow.stopMining(round_index-1)
		console.log('=== Round Switch === : '+round_index);
	})
	

	setInterval(function(){
		console.log(`Minier Status :${bMining}, ready to checkTrustMEAndStartMinig`)
		round.getCurrentRoundIndexByDb(function(round_index){
			checkRoundAndComposeCoinbase(round_index);
			if(bMining || bPowSent) {
				return
			}
			checkTrustMEAndStartMinig(round_index);
		})
	},10*1000);

	eventBus.on("launch_pow", function(round_index) {
		checkTrustMEAndStartMinig(round_index)
	})
	
	eventBus.on("pow_mined_gift", function(solution){
		console.log('===Will compose POW joint===');
		if(my_address == constants.FOUNDATION_ADDRESS) {
			bMining = false;
			return console.log('Foundation will not mine');
		}
	
		const callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: onMiningError,
			ifError: onMiningError,
			ifOk: function(objJoint){
				bMining = false;
				bPowSent = true;
				network.broadcastJoint(objJoint);
				console.log('===Pow=== objJoin sent')
			}
		})
	
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				if(round_index != solution.round){
					conn.release();
					return console.log("Round switched won't compose pow with wrong round index")
				}
				round.checkIfPowUnitByRoundIndexAndAddressExists(conn, round_index, my_address, function(bExist) {
					if(bExist) {
						conn.release()
						bMining = false;
						return console.log('POW already sent');
					}
					conn.release()
					composer.composePowJoint(my_address, round_index, solution.publicSeed, solution.difficulty, {hash:solution["hash"],nonce:solution["nonce"]}, signer, callbacks)
				});
			})
		});
	})
});

function compareVersions(currentVersion, minVersion) {
	if (currentVersion === minVersion) return '==';

	var cV = currentVersion.match(/([0-9])+/g);
	var mV = minVersion.match(/([0-9])+/g);
	var l = Math.min(cV.length, mV.length);
	var diff;

	for (var i = 0; i < l; i++) {
		diff = parseInt(cV[i], 10) - parseInt(mV[i], 10);
		if (diff > 0) {
			return '>';
		} else if (diff < 0) {
			return '<'
		}
	}

	diff = cV.length - mV.length;
	if (diff == 0) {
		return '==';
	} else if (diff > 0) {
		return '>';
	} else if (diff < 0) {
		return '<';
	}
}

function issueChangeAddressAndSendPayment(asset, amount, to_address, device_address, onDone){
	if (conf.bSingleAddress){
		readSingleAddress(function(change_address){
			sendPayment(asset, amount, to_address, change_address, device_address, onDone);
		});
	}
	else if (conf.bStaticChangeAddress){
		issueOrSelectStaticChangeAddress(function(change_address){
			sendPayment(asset, amount, to_address, change_address, device_address, onDone);
		});
	}
	else{
		var walletDefinedByKeys = require('trustnote-pow-common/wallet_defined_by_keys.js');
		walletDefinedByKeys.issueOrSelectNextChangeAddress(wallet_id, function(objAddr){
			sendPayment(asset, amount, to_address, objAddr.address, device_address, onDone);
		});
	}
}

function getMyStatus(){
	db.query("SELECT count(*) FROM units JOIN unit_authors USING(unit) where address=? and pow_type=1", [my_address], function(mine_rows){
		db.query("SELECT sum(amount) FROM outputs JOIN units USING(unit) where pow_type=3 and address=?", [my_address], function(coinbase_rows){
			Wallet.readBalance(wallet_id, function(balances) {
				round.getCurrentRoundIndexByDb(function(round_index){
					cb(null, {mine:mine_rows[0], coinbase:coinbase_rows[0], balance:balances, current_round:round_index})
				})
			});
		})
	})
}

function initRPC() {
	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('trustnote-pow-common/wallet_defined_by_keys.js');
	var Wallet = require('trustnote-pow-common/wallet.js');
	var balances = require('trustnote-pow-common/balances.js');
	var mutex = require('trustnote-pow-common/mutex.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default
		'headers': { // allow custom headers is empty by default
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Returns information about the current state.
	 * @return { last_mci: {Integer}, last_stable_mci: {Integer}, count_unhandled: {Integer} }
	 */
	server.expose('getinfo', function(args, opt, cb) {
		var response = {};
		storage.readLastMainChainIndex(function(last_mci){
			response.last_mci = last_mci;
			storage.readLastStableMcIndex(db, function(last_stable_mci){
				response.last_stable_mci = last_stable_mci;
				db.query("SELECT COUNT(*) AS count_unhandled FROM unhandled_joints", function(rows){
					response.count_unhandled = rows[0].count_unhandled;
					cb(null, response);
				});
			});
		});
	});

	/**
	 * Creates and returns new wallet address.
	 * @return {String} address
	 */
	server.expose('getnewaddress', function(args, opt, cb) {
		mutex.lock(['rpc_getnewaddress'], function(unlock){
			walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo) {
				unlock();
				cb(null, addressInfo.address);
			});
		});
	});
	
	/**
	 * get all wallet address.
	 * @return [String] address
	 */
	server.expose('getalladdress', function(args, opt, cb) {
		if(args.length > 0) {
			var address = args[0];
		}
		mutex.lock(['rpc_getalladdress'], function(unlock){
			walletDefinedByKeys.readAllAddressesAndIndex(wallet_id, function(addressList) {
				unlock();
				if(address) {
					var is_exist = false;
					for (var i in addressList) {
					    if (addressList[i].indexOf(address) > 0) {
						cb(null, addressList[i]);
						is_exist = true;
						break;
					    }
					}
					if(!is_exist)
						cb("unknow address");
				}
				else {
					cb(null, addressList);
				}
			});
		});
	});

	/**
	 * check address is valid.
	 * @return [string] msg
	 */
	server.expose('checkAddress', function(args, opt, cb) {
		var address = args[0];
		if(address) {
			if(validationUtils.isValidAddress(address)) {
				cb(null, "ok");
			}
			else {
				cb("invalid address");
			}
		}
		else {
			cb("invalid address");
		}
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {String} address
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 *
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getbalance', function(args, opt, cb) {
		var address = args[0];
		if (address) {
			if (validationUtils.isValidAddress(address))
				db.query("SELECT COUNT(*) AS count FROM my_addresses WHERE address = ?", [address], function(rows) {
					if (rows[0].count)
						db.query(
							"SELECT asset, is_stable, SUM(amount) AS balance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' AND asset IS NULL \n\
							GROUP BY is_stable", [address],
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
								cb(null, balance);
							}
						);
					else
						cb("address not found");
				});
			else
				cb("invalid address");
		}
		else
			Wallet.readBalance(wallet_id, function(balances) {
				cb(null, balances);
			});
	});

	/**
	 * Returns wallet balance(stable and pending) without commissions earned from headers and witnessing.
	 *
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getmainbalance', function(args, opt, cb) {
		balances.readOutputsBalance(wallet_id, function(balances) {
			cb(null, balances);
		});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address or {since_mci: {Integer}, unit: {String}}
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 *
	 * If no address supplied, returns wallet transaction list.
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 */
	server.expose('listtransactions', function(args, opt, cb) {
		if (Array.isArray(args) && typeof args[0] === 'string') {
			var address = args[0];
			if (validationUtils.isValidAddress(address))
				Wallet.readTransactionHistory({address: address}, function(result) {
					cb(null, result);
				});
			else
				cb("invalid address");
		}
		else{
			var opts = {wallet: wallet_id};
			if (args.unit && validationUtils.isValidBase64(args.unit, constants.HASH_LENGTH))
				opts.unit = args.unit;
			else if (args.since_mci && validationUtils.isNonnegativeInteger(args.since_mci))
				opts.since_mci = args.since_mci;
			else
				opts.limit = 200;
			Wallet.readTransactionHistory(opts, function(result) {
				cb(null, result);
			});
		}

	});

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @param {Integer} amount
	 * @return {String} status
	 */
	server.expose('sendtoaddress', function(args, opt, cb) {
		// return cb(null, null);
		var amount = args[1];
		var toAddress = args[0];
		if (amount && toAddress) {
			if(typeof amount != "number" || amount <= 0) {
				cb("amount must be positive");
			}
			if (validationUtils.isValidAddress(toAddress))
				issueChangeAddressAndSendPayment(null, amount, toAddress, null, function(err, unit) {
					cb(err, err ? undefined : unit);
				});
			else
				cb("invalid address");
		}
		else
			cb("wrong parameters");
	});

	/**
	 * Get Miner info
	 * @return {String} status
	 */
	server.expose('miningStatus', function(args, opt, cb){
		getMyStatus(function(err, Status){
			if(err){
				return cb(err)
			}
			cb(null, JSON.stringify(Status))
		})
	})

	server.expose('getCycleInfo', function(args, opt, cb){
		db.query("SELECT * FROM round_cycle", function(rows){
			cb(JSON.stringify(rows));
		})
	})

	server.expose('getRoundInfo', function(args, opt, cb){
		db.query("SELECT * FROM round", function(rows){
			cb(JSON.stringify(rows));
		})
	})

	server.expose('unitInfo', function(args, opt, cb){
		var unit = args[0]
		db.query('select * from units where unit=?', unit, function(rows){
			if(rows.length===0){
				return cb('Unit not Found')
			} else {
				return cb(JSON.stringify(rows[0]))
			}
		})
	})

	server.expose('badJoints', function(args, opt, cb){
		db.query('select * from known_bad_joints', function(rows) {
			if(rows.length===0){
				return cb('Not bad Joints')
			} else {
				return cb(JSON.stringify(rows))
			}
		})
	})

	server.expose('unhandleJoints', function(args, opt, cb){
		db.query('select * from unhandle_joints', function(rows) {
			if(rows.length===0){
				return cb('Not unhandle Joints')
			} else {
				return cb(JSON.stringify(rows))
			}
		})
	})

	readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only
		server.listen(conf.rpcPort, conf.rpcInterface);
	});
}

if(conf.bServeAsRpc){
	eventBus.on('headless_wallet_ready', initRPC);
}