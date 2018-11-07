/*jslint node: true */
"use strict";
var conf = require('trustnote-pow-common/config/conf');
var ValidationUtils = require("trustnote-pow-common/validation/validation_utils.js");
var constants = require('trustnote-pow-common/config/constants.js');

/**
 * create Miner Shared Address
 * @param my_address {String} supernode address
 * @param amount {Number} the amount of shared address
 * @param callback - callback(shared_address) {String} miner shared address
 */
function createMinerDepositAddress(my_address, amount, callback) {
	var deposit = require('trustnote-pow-common/sc/deposit.js');
	
	if (!ValidationUtils.isValidAddress(my_address))
		return console.log('Please send a valid address');

    function onError(err) {
		// throw Error(err);
		console.log("Error: " + err)
        callback("Error: " + err);
    }

	deposit.hasInvalidUnitsFromHistory(null, my_address, function(err, hasInvalid) {
		if(err) {
			return onError(err)
		} else if (hasInvalid) {
			return onError("Your address had invalid joints. If you still want to be a miner, please create new joint or use other mnemonic codes")
		}
		var address = conf.safe_address ?  conf.safe_address : my_address
		deposit.createDepositAddress(address, {
			ifError: onError,
			ifOk: function (deposit_address) {
				var wallet = require('./wallet.js');
				var composer = require('trustnote-pow-common/unit/composer.js');
				var network = require('trustnote-pow-common/p2p/network.js');
				var device = require('trustnote-pow-common/wallet/device.js');
				var callbacks = composer.getSavingCallbacks({
					ifNotEnoughFunds: onError,
					ifError: onError,
					ifOk: function(objJoint){
						network.broadcastJoint(objJoint);
						callback(null, deposit_address);
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
					signer: wallet.signer,
					callbacks: callbacks
				};
				var arrDefinition = [
					'or', 
					[
						['address', constants.FOUNDATION_SAFE_ADDRESS],
						['address', my_address],
					]
				];
				var assocSignersByPath={
					'r.0.0': {
						address: constants.FOUNDATION_SAFE_ADDRESS,
						member_signing_path: 'r',
						device_address: constants.FOUNDATION_DEVICE_ADDRESS
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
	})
}

/**
 * export
 */
exports.createMinerDepositAddress = createMinerDepositAddress;