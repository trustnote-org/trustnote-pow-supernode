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
							// rl.close();
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
				if (bWalletExists)
					onDone(keys.mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
				else{
					var mnemonic = new Mnemonic(keys.mnemonic_phrase);
					xPrivKey = mnemonic.toHDPrivateKey(passphrase);
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
				signWithLocalPrivateKey('', row.account, row.is_change, row.address_index, buf_to_sign, function(sig){
					handleSignature(null, sig);
				});
			}
		);
	}
};

exports.readKeys = readKeys;
exports.writeKeys = writeKeys;
exports.createWallet = createWallet;
exports.signWithLocalPrivateKey = signWithLocalPrivateKey;
exports.signer = signer;