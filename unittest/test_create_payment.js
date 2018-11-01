/*jslint node: true */
"use strict";
require('../start');
var headlessWallet = require('../lib/wallet.js');
var eventBus = require('trustnote-pow-common/base/event_bus.js');

function onError(err){
	throw Error(err);
}

function createPayment(){
	var composer = require('trustnote-pow-common/unit/composer.js');
	var network = require('trustnote-pow-common/p2p/network.js');
	var callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
		}
	});

	var from_address = "W3BAX3ECVSEQNMO7BJDMOUUEML4JO5Q3";
	var payee_address = "FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY";
	var arrOutputs = [
		{address: from_address, amount: 0},      // the change
		{address: payee_address, amount: 50000}  // the receiver
	];
	composer.composePaymentJoint([from_address], arrOutputs, headlessWallet.signer, callbacks);
}

eventBus.on('headless_wallet_ready', createPayment);
