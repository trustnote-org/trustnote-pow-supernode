/*jslint node: true */
"use strict";

exports.clientName = 'TTT';
exports.minClientVersion = '1.1.0';
exports.WS_PROTOCOL = 'ws://';
// https://console.developers.google.com
exports.pushApiProjectNumber = 0;
exports.pushApiKey = '';

exports.port = 6616;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = true;
exports.bSaveJointJson = true;
exports.bLight = false;

// this is used by wallet vendor only, to redirect bug reports to developers' email
exports.bug_sink_email = 'admin@example.org';
exports.bugs_from_email = 'bugs@example.org';

exports.HEARTBEAT_TIMEOUT = 300*1000;

exports.initial_peers = [
    "127.0.0.1:6616",
    "127.0.0.1:6617"
];

exports.storage = 'sqlite';

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
