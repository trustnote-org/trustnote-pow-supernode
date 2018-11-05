var db = require('trustnote-pow-common/db/db.js');
var conf = require('../conf.js');
var create_deposit_address = require("trustnote-pow-common/sc/deposit.js");
var wallet = require('./wallet.js');

var wallet_id;
var my_address;

/**
 * read single wallet
 * @param {function} handleWallet - handleWallet(wallet)
 */
function readSingleWallet(handleWallet){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleWallet(rows[0].wallet);
	});
}

/**
 * read single address
 * @param {function} handleAddress - handleAddress(address)
 */
function readSingleAddress(handleAddress){
	db.query("SELECT address FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address);
	});
}

/**
 * 
 * @param {String} asset - type of asset, default base
 * @param {Number} amount - amount of payment
 * @param {String} to_address - address that receives money
 * @param {String} change_address - address that receives change
 * @param {String} device_address - device address of the address that recieves money
 * @param {callbace} onDone - onDone(err) if err is true, means there is a error
 */
function sendPayment(asset, amount, to_address, change_address, device_address, onDone){
	var device = require('trustnote-pow-common/wallet/device.js');
	var Wallet = require('trustnote-pow-common/wallet/wallet.js');
	Wallet.sendPaymentFromWallet(
		asset, wallet_id, to_address, amount, change_address,
		[], device_address,
		wallet.signWithLocalPrivateKey,
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

/**
 * RPC APIs
 */
function initRPC() {
    var rpc = require('json-rpc2');
    var db = require('trustnote-pow-common/db/db.js');
	var walletDefinedByKeys = require('trustnote-pow-common/wallet/wallet_defined_by_keys.js');
	var Wallet = require('trustnote-pow-common/wallet/wallet.js');
	var balances = require('trustnote-pow-common/wallet/balances.js');
	var mutex = require('trustnote-pow-common/base/mutex.js');
	var storage = require('trustnote-pow-common/db/storage.js');

	function getMyStatus(cb){
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
				sendPayment(null, amount, toAddress, null, function(err, unit) {
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
			cb(null, JSON.stringify(rows));
		})
	})

	server.expose('getRoundInfo', function(args, opt, cb){
		db.query("SELECT * FROM round", function(rows){
			cb(null, JSON.stringify(rows));
		})
	})

	server.expose('unitInfo', function(args, opt, cb){
		var unit = args[0]
		db.query('select * from units where unit=?', unit, function(rows){
			if(rows.length===0){
				return cb(null, 'Unit not Found')
			} else {
				return cb(null, JSON.stringify(rows[0]))
			}
		})
	})

	server.expose('badJoints', function(args, opt, cb){
		db.query('select * from known_bad_joints', function(rows) {
			if(rows.length===0){
				return cb(null, 'Not bad Joints')
			} else {
				return cb(null, JSON.stringify(rows))
			}
		})
	})

	server.expose('unhandledJoints', function(args, opt, cb){
		db.query('select * from unhandled_joints', function(rows) {
			if(rows.length===0){
				return cb(null, "No unhandled Joints")
			} else {
				return cb(null, JSON.stringify(rows))
			}
		})
	})

	/**
	 * create miner deposit address
	 * @param {number} amount - how much will you sent to your deposit address
	 */
	server.expose('createMinerAddress', function(args, opt, cb){
		mutex.lock(['rpc_getalladdress'], function(unlock){
			db.query('select * from supernode where address=?', [my_address], function(rows){
				if(rows.length>=1){
					unlock()
					return cb(null, rows[0].deposit_address)
				}
				var amount = args[0];
				if( amount <= 0) {
					return cb("Amount must be more than 0")
				}
				var createDepositAddress = require('./create_deposit_address.js');
				createDepositAddress.createMinerDepositAddress(my_address, amount, function(err, shared_address){
					unlock()
					return cb(err, shared_address);
				});
			})
		})
	})

	server.expose('sendpaymentfromdepositaddress', function(args, opt, cb){
		var to_address = args[0];
		var amount = args[1];

		mutex.lock(['sendpaymentfromdepositaddress'], function(unlock) {
			create_deposit_address.getDepositAddressBySupernode(null, my_address, function(err, deposit_address){
				var composer = require('trustnote-pow-common/unit/composer.js');
				var network = require('trustnote-pow-common/p2p/network.js');
				var callbacks = composer.getSavingCallbacks({
					ifNotEnoughFunds: function(err){
						unlock()
						return cb(err)
					},
					ifError: function(err){
						unlock()
						return cb(err)
					},
					ifOk: function(objJoint){
						network.broadcastJoint(objJoint);
						unlock()
						return cb(null, 'successful')
					}
				});

				var from_address = deposit_address;
				var payee_address = to_address;
				var arrOutputs = [
					{address: from_address, amount: 0},      // the change
					{address: payee_address, amount: amount}  // the receiver
				];
				composer.composePaymentJoint([from_address], arrOutputs, wallet.signer, callbacks);
			})
		})	
	})

	readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		readSingleAddress(function(_my_address){
			my_address = _my_address;
			// listen creates an HTTP server on localhost only
			server.listen(conf.rpcPort, conf.rpcInterface);
		})
	});
}

exports.initRPC = initRPC;