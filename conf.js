/*jslint node: true */
"use strict";

/**
 *	for version control
 */
exports.clientName		= 'trustnote-pow-supernode';
exports.minClientVersion	= '1.1.0';


exports.WS_PROTOCOL = 'ws://';
// https://console.developers.google.com
exports.pushApiProjectNumber = 0;
exports.pushApiKey = '';

exports.port = 9191;
//exports.myUrl = 'ws://10.10.11.68:9191';
exports.bServeAsHub = true;
exports.bSaveJointJson = true;
exports.bLight = false;
exports.bServeAsRpc = true;
exports.rpcInterface = '127.0.0.1';
exports.rpcPort = 6553;

// this is used by wallet vendor only, to redirect bug reports to developers' email
exports.bug_sink_email = 'admin@example.org';
exports.bugs_from_email = 'bugs@example.org';

exports.HEARTBEAT_TIMEOUT = 300*1000;

exports.initial_peers = [
    "ws://test.mainchain.pow.trustnote.org:9191",
];

exports.storage = 'sqlite';

exports.deviceName = 'Supernode';
exports.permanent_pairing_secret = 'randomstring';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 7;
exports.MIN_AVAILABLE_WITNESSINGS = 100;
exports.bPostTimestamp = false;

exports.start_mining_round = 0;
exports.maxWorkderCount = 0;

exports.KEYS_FILENAME = 'keys.json';

exports.SUPERNODE_SAFE_ADDRESS = null;

console.log('finished witness conf');
