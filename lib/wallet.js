var fs = require('fs');
var crypto = require('crypto');
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');
var readline = require('readline');

var conf = require('trustnote-pow-common/config/conf.js');
var objectHash = require('trustnote-pow-common/base/object_hash.js');
var db = require('trustnote-pow-common/db/db.js');
var ecdsaSig = require('trustnote-pow-common/encrypt/signature.js');
var constants = require('trustnote-pow-common/config/constants.js');
var desktopApp = require('trustnote-pow-common/base/desktop_app.js');

var appDataDir = desktopApp.getAppDataDir();
var KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');
var xPrivKey;

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
					// rl.question(
					console.log('Device name saved to '+userConfFile+', you can edit it later if you like.\n\nPassphrase for your private keys: ')
						// function(passphrase){
					rl.close();
					var passphrase = ""
					if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
					if (process.stdout.clearLine)  process.stdout.clearLine();
					var deviceTempPrivKey = crypto.randomBytes(32);
					var devicePrevTempPrivKey = crypto.randomBytes(32);

					var mnemonic = new Mnemonic(); // generates new mnemonic
					while (!Mnemonic.isValid(mnemonic.toString()))
						mnemonic = new Mnemonic();

					writeKeys(mnemonic.phrase, deviceTempPrivKey, devicePrevTempPrivKey, function(){
						console.log('keys created');
						xPrivKey = mnemonic.toHDPrivateKey(passphrase);
						createWallet(xPrivKey, function(){
							onDone(mnemonic.phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
						});
					});
						// }
					// );
				});
			});
		}
		else{ // 2nd or later start
			// rl.question("Passphrase: ", function(passphrase){
			var passphrase = "";
			rl.close();
			if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
			if (process.stdout.clearLine)  process.stdout.clearLine();
			var keys = JSON.parse(data);
			var deviceTempPrivKey = Buffer(keys.temp_priv_key, 'base64');
			var devicePrevTempPrivKey = Buffer(keys.prev_temp_priv_key, 'base64');
			determineIfWalletExists(function(bWalletExists){
				if(!Mnemonic.isValid(keys.mnemonic_phrase)) throw Error('Invalid mnemonic_phrase in ' + KEYS_FILENAME)
				var mnemonic = new Mnemonic(keys.mnemonic_phrase);
				xPrivKey = mnemonic.toHDPrivateKey(passphrase);
				if (bWalletExists)
					onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
				else{
					createWallet(xPrivKey, function(){
						onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
					});
				}
			});
			// });
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
	var device = require('trustnote-pow-common/wallet/device.js');
	device.setDevicePrivateKey(devicePrivKey); // we need device address before creating a wallet
	var strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
	var walletDefinedByKeys = require('trustnote-pow-common/wallet/wallet_defined_by_keys.js');
	walletDefinedByKeys.createWalletByDevices(strXPubKey, 0, 1, [], 'any walletName', function(wallet_id){
		walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(){
			onDone();
		});
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

function readFullSigningPaths(conn, address, arrSigningDeviceAddresses, handleSigningPaths){
	
	var assocSigningPaths = {};
	
	function goDeeper(member_address, path_prefix, onDone){
		// first, look for wallet addresses
		var sql = "SELECT signing_path FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address=?";
		var arrParams = [member_address];
		if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
			sql += " AND device_address IN(?)";
			arrParams.push(arrSigningDeviceAddresses);
		}
		conn.query(sql, arrParams, function(rows){
			rows.forEach(function(row){
				assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'key';
			});
			if (rows.length > 0)
				return onDone();
			// next, look for shared addresses, and search from there recursively
			sql = "SELECT signing_path, address FROM shared_address_signing_paths WHERE shared_address=?";
			arrParams = [member_address];
			if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
				sql += " AND device_address IN(?)";
				arrParams.push(arrSigningDeviceAddresses);
			}
			conn.query(sql, arrParams, function(rows){
				if(rows.length > 0) {
					async.eachSeries(
						rows,
						function (row, cb) {
							if (row.address === '') { // merkle
								assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'merkle';
								return cb();
							}

							goDeeper(row.address, path_prefix + row.signing_path.substr(1), cb);
						},
						onDone
					);
				} else {
					assocSigningPaths[path_prefix] = 'key';
					onDone();
				}
			});
		});
	}
	
	goDeeper(address, 'r', function(){
		handleSigningPaths(assocSigningPaths); // order of signing paths is not significant
	});
}

function findAddress(address, signing_path, callbacks, fallback_remote_device_address){
	db.query(
		"SELECT wallet, account, is_change, address_index, full_approval_date, device_address \n\
		FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
		WHERE address=? AND signing_path=?",
		[address, signing_path],
		function(rows){
			if (rows.length > 1)
				throw Error("more than 1 address found");
			if (rows.length === 1){
				var row = rows[0];
				if (!row.full_approval_date)
					return callbacks.ifError("wallet of address "+address+" not approved");
				if (row.device_address !== device.getMyDeviceAddress())
					return callbacks.ifRemote(row.device_address);
				var objAddress = {
					address: address,
					wallet: row.wallet,
					account: row.account,
					is_change: row.is_change,
					address_index: row.address_index
				};
				callbacks.ifLocal(objAddress);
				return;
			}
			db.query(
			//	"SELECT address, device_address, member_signing_path FROM shared_address_signing_paths WHERE shared_address=? AND signing_path=?", 
				// look for a prefix of the requested signing_path
				"SELECT address, device_address, signing_path FROM shared_address_signing_paths \n\
				WHERE shared_address=? AND signing_path=SUBSTR(?, 1, LENGTH(signing_path))", 
				[address, signing_path],
				function(sa_rows){
					if (rows.length > 1)
						throw Error("more than 1 member address found for shared address "+address+" and signing path "+signing_path);
					if (sa_rows.length === 0){
						if (fallback_remote_device_address)
							return callbacks.ifRemote(fallback_remote_device_address);
						return callbacks.ifUnknownAddress();
					}
					var objSharedAddress = sa_rows[0];
					var relative_signing_path = 'r' + signing_path.substr(objSharedAddress.signing_path.length);
					var bLocal = (objSharedAddress.device_address === device.getMyDeviceAddress()); // local keys
					if (objSharedAddress.address === '')
						return callbacks.ifMerkle(bLocal);
					findAddress(objSharedAddress.address, relative_signing_path, callbacks, bLocal ? null : objSharedAddress.device_address);
				}
			);
		}
	);
}

var signer = {
	readSigningPaths: function(conn, address, handleLengthsBySigningPaths){ // returns assoc array signing_path => length
		readFullSigningPaths(conn, address, arrSigningDeviceAddresses, function(assocTypesBySigningPaths){
			var assocLengthsBySigningPaths = {};
			for (var signing_path in assocTypesBySigningPaths){
				var type = assocTypesBySigningPaths[signing_path];
				if (type === 'key')
					assocLengthsBySigningPaths[signing_path] = constants.SIG_LENGTH;
				else if (type === 'merkle'){
					if (merkle_proof)
						assocLengthsBySigningPaths[signing_path] = merkle_proof.length;
				}
				else
					throw Error("unknown type "+type+" at "+signing_path);
			}
			handleLengthsBySigningPaths(assocLengthsBySigningPaths);
		});
	},
	readDefinition: function(conn, address, handleDefinition){
		conn.query(
			"SELECT definition FROM my_addresses WHERE address=? UNION SELECT definition FROM shared_addresses WHERE shared_address=?", 
			[address, address], 
			function(rows){
				if (rows.length !== 1)
					throw Error("definition not found");
				handleDefinition(null, JSON.parse(rows[0].definition));
			}
		);
	},
	sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
		var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
		findAddress(address, signing_path, {
			ifError: function(err){
				throw Error(err);
			},
			ifUnknownAddress: function(err){
				throw Error("unknown address "+address+" at "+signing_path);
			},
			ifLocal: function(objAddress){
				signWithLocalPrivateKey(objAddress.wallet, objAddress.account, objAddress.is_change, objAddress.address_index, buf_to_sign, function(sig){
					handleSignature(null, sig);
				});
			},
			ifRemote: function(device_address){
				// we'll receive this event after the peer signs
				eventBus.once("signature-"+device_address+"-"+address+"-"+signing_path+"-"+buf_to_sign.toString("base64"), function(sig){
					handleSignature(null, sig);
					if (sig === '[refused]')
						eventBus.emit('refused_to_sign', device_address);
				});
				walletGeneral.sendOfferToSign(device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads);
				if (!bRequestedConfirmation){
					eventBus.emit("confirm_on_other_devices");
					bRequestedConfirmation = true;
				}
			},
			ifMerkle: function(bLocal){
				if (!bLocal)
					throw Error("merkle proof at path "+signing_path+" should be provided by another device");
				if (!merkle_proof)
					throw Error("merkle proof at path "+signing_path+" not provided");
				handleSignature(null, merkle_proof);
			}
		});
	}
};


exports.readKeys = readKeys;
exports.writeKeys = writeKeys;
exports.createWallet = createWallet;
exports.signWithLocalPrivateKey = signWithLocalPrivateKey;
exports.signer = signer;