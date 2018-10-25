/*jslint node: true */
"use strict";

/**
 * create Miner Shared Address
 * @param my_address {String} supernode address
 * @param amount {Number} the amount of shared address
 * @return shared_address {String} miner shared address
 */
function createMinerDepositAddress(my_address, amount, callback) {
	var ValidationUtils = require("trustnote-pow-common/validation/validation_utils.js");
	var device = require('trustnote-pow-common/wallet/device.js');
	
	if (!ValidationUtils.isValidAddress(my_address))
		return console.log('Please send a valid address');
	
    var constants = require("trustnote-pow-common/config/constants.js");

    function sendMessageToDevice(device_address, text){
        device.sendMessageToDevice(device_address, 'text', text);
    }

    function onError(err) {
        // throw Error(err);
        console.log("Error: " + err);
    }

	// sendMessageToDevice(from_address, 'Building shared address');
	var myDeviceAddresses = device.getMyDeviceAddress();
    // var deadline = getUnlockDate();
	var arrDefinition = ['or', [
		['address', constants.FOUNDATION_ADDRESS],
		['address', my_address],]
	];
	var assocSignersByPath={
		'r.0.0': {
			address: constants.FOUNDATION_ADDRESS,
			member_signing_path: 'r',
			device_address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
		},
		'r.1.0': {
			address: my_address,
			member_signing_path: 'r',
			device_address: myDeviceAddresses
		},
	};

	/**
	 * Create Deposit Address
	 * @param {Array} arrDefinition - definiton of miner shared address
	 * @param {Object} assocSignersByPath - address paths of shared address
	 * @param {Function} callback - callback(deposit_address)
	 */
	function createDepositAddress(my_address, arrDefinition, assocSignersByPath, callback) {
		var walletDefinedByAddresses = require('trustnote-pow-common/wallet/wallet_defined_by_addresses.js');
		var objectHash = require('trustnote-pow-common/base/object_hash.js');
		var db = require('trustnote-pow-common/db/db.js');
		var shared_address = objectHash.getChash160(arrDefinition)
		db.query('SELECT * FROM supernode where address=?', [my_address], function(rows) {
			if(rows.length>=1){
				return callback(rows[0].deposit_address)
			}
			walletDefinedByAddresses.handleNewSharedAddress({address: shared_address, definition: arrDefinition, signers: assocSignersByPath}, {
				ifError: function (err) {
					sendMessageToDevice(from_address, err);
				},
				ifOk: function () {
					var signer = require('./signer.js');
					var composer = require('trustnote-pow-common/unit/composer.js');
					var network = require('trustnote-pow-common/p2p/network.js');
					var callbacks = composer.getSavingCallbacks({
						ifNotEnoughFunds: onError,
						ifError: onError,
						ifOk: function(objJoint){
							network.broadcastJoint(objJoint);
	
							// insert miner shared address into supernode after get deposit in case address has not been used.
							db.query('INSERT OR IGNORE INTO supernode (address, deposit_address) VALUES (?, ?)', [my_address, shared_address], function(){
								console.log('insert miner address finished')
							})
							
							callback(shared_address);
						}
					});
		
					var input_address = my_address;
					var arrOutputs = [
						{address: input_address, amount: 0},      // the change
						{address: shared_address, amount: amount}  // the receiver
					];
					var params = {
						paying_addresses: [input_address],
						outputs: arrOutputs,
						signer: signer.signer,
						callbacks: callbacks
					};
					params.arrShareDefinition = [{"arrDefinition":arrDefinition, "assocSignersByPath":assocSignersByPath}];
					params.callbacks = callbacks;
					composer.composeJoint(params);
				}
			})
		})
	}

	createDepositAddress(my_address, arrDefinition, assocSignersByPath, callback);
}

/**
 * export
 */
exports.createMinerDepositAddress = createMinerDepositAddress;