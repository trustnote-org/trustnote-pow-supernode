/*jslint node: true */
"use strict";

exports.clientName = 'TTT';
exports.minClientVersion = '1.1.0';
exports.WS_PROTOCOL = 'ws://';
// https://console.developers.google.com
exports.pushApiProjectNumber = 0;
exports.pushApiKey = '';

exports.port = 9191;
//exports.myUrl = 'ws://10.10.11.68:9191';
exports.bServeAsHub = true;
exports.bSaveJointJson = true;
exports.bLight = false;

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

exports.initialWitnesses = [
    '72FZXZMFPESCMUHUPWTZJ2F57YV32JCI',
    '2G6WV4QQVF75EPKSXTVRKRTZYSXNIWLU',
    '4ZJ3HQTLYK72O4PLE3GA4ZYCYXLIFHXK',
    '7RR5E6BRHE55FHE76HO6RT2E4ZP3CHYA',
    'CAGSFKGJDODHWFJF5LS7577TKVPLH7KG',
    'FX2B6E622RF4J4MM2OUWMGSOKJP7XTXB',
    'JN2N7SOMDKNSDGMVAW346BYTOSKZIIT4',
    'SAHCPBJAAOXRJ6KRSM3OGATIRSWIWOQA',
    'WL44BDM4QNCMAM5AS3ZB2GYTVDBWAS5Z'
];

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 7;
exports.MIN_AVAILABLE_WITNESSINGS = 100;
exports.bPostTimestamp = false;

exports.KEYS_FILENAME = 'keys.json';

console.log('finished witness conf');
