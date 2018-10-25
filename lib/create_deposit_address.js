/*jslint node: true */
"use strict";

/**
 * create Miner Shared Address
 * @param my_address {String} supernode address
 * @param amount {Number} the amount of shared address
 * @param callback - callback(shared_address) {String} miner shared address
 */
function createMinerDepositAddress(my_address, amount, callback) {
	var ValidationUtils = require("trustnote-pow-common/validation/validation_utils.js");
	var supernode = require('trustnote-pow-common/wallet/supernode.js');
	
	if (!ValidationUtils.isValidAddress(my_address))
		return console.log('Please send a valid address');

    function onError(err) {
        // throw Error(err);
        console.log("Error: " + err);
    }

	supernode.createDepositAddress(my_address, {
		ifError: onError,
		ifOk: function (deposit_address) {
			var signer = require('./signer.js');
			var composer = require('trustnote-pow-common/unit/composer.js');
			var network = require('trustnote-pow-common/p2p/network.js');
			var constants = require('trustnote-pow-common/config/constants.js');
			var device = require('trustnote-pow-common/wallet/device.js');
			var callbacks = composer.getSavingCallbacks({
				ifNotEnoughFunds: onError,
				ifError: onError,
				ifOk: function(objJoint){
					network.broadcastJoint(objJoint);

					// insert miner shared address into supernode after get deposit in case address has not been used.
					db.query('INSERT OR IGNORE INTO supernode (address, deposit_address) VALUES (?, ?)', [my_address, deposit_address], function(){
						console.log('insert miner address finished')
					})
					
					callback(deposit_address);
				}
			});

			var input_address = my_address;
			var myDeviceAddresses = device.getMyDeviceAddress();
			var arrOutputs = [
				{address: input_address, amount: 0},      // the change
				{address: deposit_address, amount: amount}  // the receiver
			];
			var params = {
				paying_addresses: [input_address],
				outputs: arrOutputs,
				signer: signer.signer,
				callbacks: callbacks
			};
			var arrDefinition = [
				'or', 
				[
					['address', constants.FOUNDATION_ADDRESS],
					['address', my_address],
				]
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
			
			params.arrShareDefinition = [{"arrDefinition":arrDefinition, "assocSignersByPath":assocSignersByPath}];
			params.callbacks = callbacks;
			composer.composeJoint(params);
		}
	})
}

/**
 * export
 */
exports.createMinerDepositAddress = createMinerDepositAddress;