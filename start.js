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
var storage = require('trustnote-pow-common/storage.js');
var mail = require('trustnote-pow-common/mail.js');
var round = require('trustnote-pow-common/rount.js')
var relay = require('./relay.js');
var push = require('./push.js');

var WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var bWitnessingUnderWay = false;
var forcedWitnessingTimer;
var count_witnessings_available = 0;

// pow add
var bMining = false; // if miner is mining
var currentRound = 0; // to record current round index

if (!conf.bSingleAddress)
	throw Error('witness must be single address');

var appDataDir = desktopApp.getAppDataDir();
var KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');
var wallet_id;
var xPrivKey;

function datetime() {
	let date = new Date();
	return ''+ date.getFullYear() + (date.getMonth() < 10 ? '0' :'') + date.getMonth() +
	(date.getDate() < 10 ? '0' :'') + date.getDate() + (date.getHours() < 10 ? '0' :'') + date.getHours() +
	(date.getMinutes() < 10 ? '0' :'') + date.getMinutes() + ( date.getSeconds() < 10 ? '0' :'') + date.getSeconds()
}

function replaceConsoleLog(){
	var log_filename = conf.LOG_FILENAME || (appDataDir + '/log'+ datetime() +'.txt');
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
				fs.writeFile(userConfFile, JSON.stringify({deviceName: deviceName}, null, '\t'), 'utf8', function(err){
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


if (conf.permanent_pairing_secret)
	db.query(
		"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
		[conf.permanent_pairing_secret]
	);

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
				device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
				device.setDeviceName(conf.deviceName);
				device.setDeviceHub(conf.hub);
				let my_device_pubkey = device.getMyDevicePubKey();
				console.log("====== my device address: "+my_device_address);
				console.log("====== my device pubkey: "+my_device_pubkey);
				if (conf.permanent_pairing_secret)
					console.log("====== my pairing code: "+my_device_pubkey+"@"+conf.hub+"#"+conf.permanent_pairing_secret);
				if (conf.bLight){
					var light_wallet = require('trustnote-pow-common/light_wallet.js');
					light_wallet.setLightVendorHost(conf.hub);
				}
				eventBus.emit('headless_wallet_ready');
				setTimeout(replaceConsoleLog, 1000);
			});
		});
	});
}, 1000);


function handlePairing(from_address){
	var device = require('trustnote-pow-common/device.js');
	prepareBalanceText(function(balance_text){
		device.sendMessageToDevice(from_address, 'text', balance_text);
	});
}

function sendPayment(asset, amount, to_address, change_address, device_address, onDone){
	var device = require('trustnote-pow-common/device.js');
	var Wallet = require('trustnote-pow-common/wallet.js');
	Wallet.sendPaymentFromWallet(
		asset, wallet_id, to_address, amount, change_address,
		[], device_address,
		signWithLocalPrivateKey,
		function(err, unit){
			if (device_address) {
				if (err)
					device.sendMessageToDevice(device_address, 'text', "Failed to pay: " + err);
				else
				// if successful, the peer will also receive a payment notification
					device.sendMessageToDevice(device_address, 'text', "paid");
			}
			if (onDone)
				onDone(err, unit);
		}
	);
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

function issueOrSelectStaticChangeAddress(handleAddress){
	var walletDefinedByKeys = require('trustnote-pow-common/wallet_defined_by_keys.js');
	walletDefinedByKeys.readAddressByIndex(wallet_id, 1, 0, function(objAddr){
		if (objAddr)
			return handleAddress(objAddr.address);
		walletDefinedByKeys.issueAddress(wallet_id, 1, 0, function(objAddr){
			handleAddress(objAddr.address);
		});
	});
}

function handleText(from_address, text){

	text = text.trim();
	var fields = text.split(/ /);
	var command = fields[0].trim().toLowerCase();
	var params =['',''];
	if (fields.length > 1) params[0] = fields[1].trim();
	if (fields.length > 2) params[1] = fields[2].trim();

	var walletDefinedByKeys = require('trustnote-pow-common/wallet_defined_by_keys.js');
	var device = require('trustnote-pow-common/device.js');
	switch(command){
		case 'address':
			if (conf.bSingleAddress)
				readSingleAddress(function(address){
					device.sendMessageToDevice(from_address, 'text', address);
				});
			else
				walletDefinedByKeys.issueOrSelectNextAddress(wallet_id, 0, function(addressInfo){
					device.sendMessageToDevice(from_address, 'text', addressInfo.address);
				});
			break;

		case 'balance':
			prepareBalanceText(function(balance_text){
				device.sendMessageToDevice(from_address, 'text', balance_text);
			});
			break;

		case 'pay':
			analyzePayParams(params[0], params[1], function(asset, amount){
				if(asset===null && amount===null){
					var msg = "syntax: pay [amount] [asset]";
					msg +=	"\namount: digits only";
					msg +=	"\nasset: one of '', 'bytes', 'blackbytes', ASSET_ID";
					msg +=	"\n";
					msg +=	"\nExample 1: 'pay 12345' pays 12345 bytes";
					msg +=	"\nExample 2: 'pay 12345 bytes' pays 12345 bytes";
					msg +=	"\nExample 3: 'pay 12345 blackbytes' pays 12345 blackbytes";
					msg +=	"\nExample 4: 'pay 12345 qO2JsiuDMh/j+pqJYZw3u82O71WjCDf0vTNvsnntr8o=' pays 12345 blackbytes";
					msg +=	"\nExample 5: 'pay 12345 ASSET_ID' pays 12345 of asset with ID ASSET_ID";
					return device.sendMessageToDevice(from_address, 'text', msg);
				}

				if (!conf.payout_address)
					return device.sendMessageToDevice(from_address, 'text', "payout address not defined");

				function payout(amount, asset){
					if (conf.bSingleAddress)
						readSingleAddress(function(address){
							sendPayment(asset, amount, conf.payout_address, address, from_address);
						});
					else
						// create a new change address or select first unused one
						issueChangeAddressAndSendPayment(asset, amount, conf.payout_address, from_address);
				};

				if(asset!==null){
					db.query("SELECT unit FROM assets WHERE unit=?", [asset], function(rows){
						if(rows.length===1){
							// asset exists
							payout(amount, asset);
						}else{
							// unknown asset
							device.sendMessageToDevice(from_address, 'text', 'unknown asset: '+asset);
						}
					});
				}else{
					payout(amount, asset);
				}

			});
			break;

		default:
				return device.sendMessageToDevice(from_address, 'text', "unrecognized command");
	}
}

function analyzePayParams(amountText, assetText, cb){
	// expected:
	// amountText = amount; only digits
	// assetText = asset; '' -> whitebytes, 'bytes' -> whitebytes, 'blackbytes' -> blackbytes, '{asset-ID}' -> any asset

	if (amountText===''&&assetText==='') return cb(null, null);

	var pattern = /^\d+$/;
    if(pattern.test(amountText)){

		var amount = parseInt(amountText);

		var asset = assetText.toLowerCase();
		switch(asset){
			case '':
			case 'bytes':
				return cb(null, amount);
			case 'blackbytes':
				return cb(constants.BLACKBYTES_ASSET, amount);
			default:
				// return original assetText string because asset ID it is case sensitive
				return cb(assetText, amount);
		}

	}else{
		return cb(null, null);
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
		notifyAdminAboutFailedWitnessing(err);
		setTimeout(onDone, 60000); // pause after error
	}
	var network = require('trustnote-pow-common/network.js');
	var composer = require('trustnote-pow-common/composer.js');
	if (!network.isConnected()){
		console.log('not connected, skipping');
		return onDone();
	}
	createOptimalOutputs(function(){
		var callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: onError,
			ifError: onError,
			ifOk: function(objJoint){
				network.broadcastJoint(objJoint);
				onDone();
			}
		})
		composer.composeTrustMEJoint(my_address, signer, callbacks);
	});
}


function checkAndWitness(){
	console.log('checkAndWitness');
	clearTimeout(forcedWitnessingTimer);
	if (bWitnessingUnderWay)
		return console.log('witnessing under way');
	bWitnessingUnderWay = true;
	// abort if there are my units without an mci
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){ // pow del
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return console.log('my units without mci');
		}
		// pow add
		determineIfIAmWitness(function(bWitness){
			// pow add
			if (!bWitness){
				bWitnessingUnderWay = false;
				return console.log('I am not an attestor for now')
			}
			storage.readLastMainChainIndex(function(max_mci){
				let col = (conf.storage === 'mysql') ? 'main_chain_index' : 'unit_authors.rowid';
				db.query(
					"SELECT main_chain_index AS max_my_mci FROM units JOIN unit_authors USING(unit) WHERE address=? ORDER BY "+col+" DESC LIMIT 1",
					[my_address],
					function(rows){
						var max_my_mci = (rows.length > 0) ? rows[0].max_my_mci : -1000;
						var distance = max_mci - max_my_mci;
						console.log("distance="+distance);
						if (distance > conf.THRESHOLD_DISTANCE){
							console.log('distance above threshold, will witness');
							//modi winess payment victor
							//setTimeout(function(){
							//	witness(function(){
							//		bWitnessingUnderWay = false;
							//	});
							//}, Math.round(Math.random()*3000));
							bWitnessingUnderWay = false;
							checkForUnconfirmedUnitsAndWitness(conf.THRESHOLD_DISTANCE/distance);
						}
						else{
							bWitnessingUnderWay = false;
							checkForUnconfirmedUnits(conf.THRESHOLD_DISTANCE - distance);
						}
					}
				);
			});
		});
	});
}

// pow add
function determineIfIAmWitness(handleResult){
	round.getCurrentRoundIndex(function(index){
		round.getWitnessesByRoundIndex(index, function(arrWitnesses){
			db.query(
				"SELECT 1 FROM my_addresses where address IN(?)", [arrWitnesses], function(rows) {
					if(rows.length===0) {
						return handleResult(false)
					}
					return handleResult(true)
				}
			)
		})
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
function checkForUnconfirmedUnitsAndWitness(distance_to_threshold){
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
			var timeout = Math.round((distance_to_threshold + Math.random())*1000);
			console.log('scheduling unconditional witnessing in '+timeout+' ms unless a new unit arrives');
			forcedWitnessingTimer = setTimeout(witnessBeforeThreshold, timeout);
		}
	);
}

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
		determineIfIAmWitness(function(bWitness){
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
	readNumberOfWitnessingsAvailable(function(count){
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs();
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1",
			[my_address, 2*WITNESSING_COST],
			function(rows){
				if (rows.length === 0){
					notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, and can't add more");
					return handleOutputs();
				}
				var amount = rows[0].amount;
				notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({amount: Math.round(amount/2), address: my_address});
				handleOutputs();
			}
		);
	});
}

function checkTrustMEAndStartMinig() {
	round.getCurrentRoundIndex(function(round_index) {
		if (currentRound !== round_index) {
			currentRound = round_index;
			if (bMining) {
				notifyMinerStopCurrentMiningAndRestart()
			} else {
				notifyMinerStartMining()
				bMining = true;
			}
		}
	})
}

setInterval(checkTrustMEAndStartMinig, 10000);

eventBus.on('headless_wallet_ready', function(){
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
});

eventBus.on('peer_version', function (ws, body) {
	if (body.program == conf.clientName) {
		if (conf.minClientVersion && compareVersions(body.program_version, '1.0.7') == '==')
			return;
		if (conf.minClientVersion && compareVersions(body.program_version, conf.minClientVersion) == '<')
			network.sendJustsaying(ws, 'new_version', {version: conf.minClientVersion});
		// if (compareVersions(body.program_version, '1.5.1') == '<')
		// 	ws.close(1000, "mandatory upgrade");
	}
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
