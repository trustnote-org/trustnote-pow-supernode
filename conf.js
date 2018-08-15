/*jslint node: true */
"use strict";

exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';


exports.hub = '127.0.0.1:6616';
exports.deviceName = 'Supernode';
exports.permanent_pairing_secret = 'randomstring';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.initialWitnesses = [];

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 7;
exports.MIN_AVAILABLE_WITNESSINGS = 100;
exports.bPostTimestamp = false;

exports.KEYS_FILENAME = 'keys.json';

console.log('finished witness conf');
