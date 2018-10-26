/*jslint node: true */
"use strict";
var Mnemonic = require('bitcore-mnemonic');

var constants = require('trustnote-pow-common/config/constants.js');
var conf = require('trustnote-pow-common/config/conf.js');
var objectHash = require('trustnote-pow-common/base/object_hash.js');
var desktopApp = require('trustnote-pow-common/base/desktop_app.js');
var db = require('trustnote-pow-common/db/db.js');
var eventBus = require('trustnote-pow-common/base/event_bus.js');
var round = require('trustnote-pow-common/pow/round.js');
var pow = require('trustnote-pow-common/pow/pow.js');

require('./lib/relay.js');
require('./lib/push.js');
var logging = require('./lib/logging.js');
var wallet = require('./lib/wallet.js');

if (!conf.bSingleAddress)
	throw Error('witness must be single address');

var WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var bWitnessingUnderWay = false;
var forcedWitnessingTimer;
var count_witnessings_available = 0;
var last_round_index = 0;
var wallet_id;
var xPrivKey;
var interval;
var bMining = false; // if miner is mining
var bPowSent = false; // if pow joint is sent

function onError(err){
	// throw Error(err);
	console.log("Error: " + err);
}

function onMiningError(err){
	// throw Error(err);
	bMining = false;
	console.log("Mining Error: " + JSON.stringify(err));
}

function readSingleAddress(handleAddress){
	db.query("SELECT address FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address);
	});
}

function readSingleWallet(handleWallet){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleWallet(rows[0].wallet);
	});
}

// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys

function witness(onDone){
	function onError(){
		// notifyAdminAboutFailedWitnessing(err);
		setTimeout(onDone, 60000); // pause after error
	}
	var network = require('trustnote-pow-common/p2p/network.js');
	var composer = require('trustnote-pow-common/unit/composer.js');
	if (!network.isConnected()){
		console.log('not connected, skipping');
		return onDone();
	}

	const callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			onDone();
		}
	})
	db.takeConnectionFromPool(function(conn){
		round.getCurrentRoundIndex(conn, function(round_index){
			determineIfIAmWitness(conn, round_index, function(bWitness){
				conn.release()
				if(!bWitness) {
					bWitnessingUnderWay = false;
					return console.log('I am not an attestor for now')
				}
				createOptimalOutputs(function(arrOutputs){
					if (conf.bPostTimestamp) {
						var params = {
							paying_addresses: [my_address],
							outputs: arrOutputs,
							pow_type: constants.POW_TYPE_TRUSTME,
							round_index: round_index,
							signer: wallet.signer,
							callbacks: callbacks
						}
						var timestamp = Date.now();
						var datafeed = {timestamp: timestamp};
						var objMessage = {
							app: "data_feed",
							payload_location: "inline",
							payload_hash: objectHash.getBase64Hash(datafeed),
							payload: datafeed
						};
						params.messages = [objMessage];
						return composer.composeJoint(params);
					}
					composer.composeTrustMEJoint(my_address, round_index, wallet.signer, callbacks);
				});
			})
		})
	})
}


function checkAndWitness(){
	var storage = require('trustnote-pow-common/db/storage.js');
	console.log('checkAndWitness');
	clearTimeout(forcedWitnessingTimer);
	if (bWitnessingUnderWay)
		return console.log('witnessing under way');
	bWitnessingUnderWay = true;
	// abort if there are my units without an mci
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return console.log('my units without mci');
		}
		// pow add
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				determineIfIAmWitness(conn, round_index, function(bWitness){
					conn.release()
					// pow add
					console.log('CheckIfIamWitnessRound:'+round_index)
					if (!bWitness){
						bWitnessingUnderWay = false;
						return console.log('I am not an attestor for now')
					}
					storage.readLastMainChainIndex(function(max_mci){
						let col = (conf.storage === 'mysql') ? 'main_chain_index' : 'unit_authors.rowid';
						db.query(
							"SELECT main_chain_index AS max_my_mci, "+db.getUnixTimestamp('creation_date')+" AS last_ts \n\
							FROM units JOIN unit_authors USING(unit) WHERE +address=? ORDER BY "+col+" DESC LIMIT 1", 
							[my_address],
							function(rows){
								var max_my_mci = (rows.length > 0) ? rows[0].max_my_mci : -1000;
								var distance = max_mci - max_my_mci;
								if (distance > conf.THRESHOLD_DISTANCE){
									console.log('distance above threshold, will witness');
									setTimeout(function(){
										witness(function(){
											bWitnessingUnderWay = false;
										});
									}, Math.round(Math.random()*2000));
								} else {
									bWitnessingUnderWay = false;
									checkForUnconfirmedUnits(conf.THRESHOLD_DISTANCE - distance);
								}
							}
						);
					});
				});
			})
		})
	});
}

// pow add
function determineIfIAmWitness(conn, round_index, handleResult){
	round.getWitnessesByRoundIndex(conn, round_index, function(arrWitnesses){
		conn.query(
			"SELECT 1 FROM my_addresses where address IN(?)", [arrWitnesses], function(rows) {
				if(rows.length===0) {
					return handleResult(false)
				}
				return handleResult(true)
			}
		)
	})
}

function determineIfThereAreMyUnitsWithoutMci(handleResult){
	db.query("SELECT 1 FROM units JOIN unit_authors USING(unit) WHERE address=? AND main_chain_index IS NULL LIMIT 1", [my_address], function(rows){
		handleResult(rows.length > 0);
	});
}

function checkForUnconfirmedUnits(distance_to_threshold){
	var storage = require('trustnote-pow-common/db/storage.js');
	db.query( // look for unstable non-witness-authored units
		// pow modi
		"SELECT 1 FROM units CROSS JOIN unit_authors USING(unit)\n\
		WHERE (main_chain_index>? OR main_chain_index IS NULL AND sequence='good') \n\
			AND NOT ( \n\
				(SELECT COUNT(*) FROM messages WHERE messages.unit=units.unit)=1 \n\
				AND (SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit)=1 \n\
				AND (SELECT COUNT(DISTINCT address) FROM outputs WHERE outputs.unit=units.unit)=1 \n\
				AND (SELECT address FROM outputs WHERE outputs.unit=units.unit LIMIT 1)=unit_authors.address \n\
			) \n\
		LIMIT 1",
		[storage.getMinRetrievableMci()], // light clients see all retrievable as unconfirmed
		function(rows){
			if (rows.length === 0)
				return;
			var timeout = Math.round((distance_to_threshold + Math.random())*7000);
			console.log('scheduling unconditional witnessing in '+timeout+' ms unless a new unit arrives');
			forcedWitnessingTimer = setTimeout(witnessBeforeThreshold, timeout);
		}
	);
}

function witnessBeforeThreshold(){
	if (bWitnessingUnderWay)
		return;
	bWitnessingUnderWay = true;
	determineIfThereAreMyUnitsWithoutMci(function(bMyUnitsWithoutMci){
		if (bMyUnitsWithoutMci){
			bWitnessingUnderWay = false;
			return console.log('my units without mci');
		}
		// pow add
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				determineIfIAmWitness(conn, round_index, function(bWitness){
					conn.release()
					// pow add
					if (!bWitness){
						bWitnessingUnderWay = false;
						return console.log('I am not an attestor for now')
					}
					console.log('will witness before threshold');
					witness(function(){
						bWitnessingUnderWay = false;
					});
				});
			});
		})	
	});
}

function readNumberOfWitnessingsAvailable(handleNumber){
	count_witnessings_available--;
	if (count_witnessings_available > conf.MIN_AVAILABLE_WITNESSINGS)
		return handleNumber(count_witnessings_available);
	db.query(
		"SELECT COUNT(*) AS count_big_outputs FROM outputs JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0",
		[my_address, WITNESSING_COST],
		function(rows){
			var count_big_outputs = rows[0].count_big_outputs;
			db.query(
				"SELECT SUM(amount) AS total FROM outputs JOIN units USING(unit) \n\
				WHERE address=? AND is_stable=1 AND amount<? AND asset IS NULL AND is_spent=0",
				[my_address, WITNESSING_COST],
				function(rows){
					var total = rows.reduce(function(prev, row){ return (prev + row.total); }, 0);
					var count_witnessings_paid_by_small_outputs_and_commissions = Math.round(total / WITNESSING_COST);
					count_witnessings_available = count_big_outputs + count_witnessings_paid_by_small_outputs_and_commissions;
					handleNumber(count_witnessings_available);
				}
			);
		}
	);
}

// make sure we never run out of spendable (stable) outputs. Keep the number above a threshold, and if it drops below, produce more outputs than consume.
function createOptimalOutputs(handleOutputs){
	var arrOutputs = [{amount: 0, address: my_address}];
	readNumberOfWitnessingsAvailable(function(count){
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs(arrOutputs);
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1",
			[my_address, 2*WITNESSING_COST],
			function(rows){
				if (rows.length === 0){
					// notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, and can't add more");
					return handleOutputs(arrOutputs);
				}
				var amount = rows[0].amount;
				// notifyAdminAboutWitnessingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({amount: Math.round(amount/2), address: my_address});
				handleOutputs(arrOutputs);
			}
		);
	});
}

function checkTrustMEAndStartMining(round_index){
	if(round_index < last_round_index) {
		return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
	}
	if(bMining || bPowSent) {
		return console.log(`Checking if I can Mining ${ bMining } ${ bPowSent } ${ round_index }`)
	}
	if(my_address == constants.FOUNDATION_ADDRESS) {
		return console.log('Foundation will not mine');
	}
	if(conf.start_mining_round > round_index) {
		return console.log("Current round is to early, will not be mining")
	}
	console.log(`Mining is on going : ${ bMining } Round : ${ round_index }`)
	bMining = true;
	db.takeConnectionFromPool(function(conn){
		conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
		[round_index, constants.POW_TYPE_TRUSTME], function(rows){
			if(rows.length>=1){
				pow.obtainMiningInput(conn, round_index, function(err, input_object) {
					conn.release();
					if (err) {
						// notifyAdminAboutWitnessingProblem(err)
						return onMiningError(err);
					}
					else {
						interval = Date.now()
						logging.infoStartMining(input_object);
						pow.startMiningWithInputs(input_object, function(err){
							if (err) {
								return onMiningError(err);
							} else {
								console.log("Mining is on going");
							}
						})
					}
				})
			}
			else {
				bMining = false;
				conn.release();
			}
		})
	})
}

function checkRoundAndComposeCoinbase(round_index) {
	if(round_index===1) {
		return;
	}
	if(round_index < last_round_index) {
		return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
	}

	var network = require('trustnote-pow-common/p2p/network.js');
	var composer = require('trustnote-pow-common/unit/composer.js');

	const callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: onError,
		ifError: onError,
		ifOk: function(objJoint){
			network.broadcastJoint(objJoint);
			if(objJoint.unit.messages[0].payload.outputs[0].amount)
				logging.infoCoinbaseReward(objJoint.unit.round_index, objJoint.unit.messages[0].payload.outputs[0].amount);
			else
				logging.infoCoinbaseReward(objJoint.unit.round_index, 0);
			console.log('=== Coinbase sent ===')
		}
	})
	
	console.log('Going to compose Coinbase')
	db.takeConnectionFromPool(function(conn){
		determineIfIAmWitness(conn, round_index-1, function(bWitness){
			if(bWitness) {
				conn.query("SELECT witnessed_level FROM units WHERE round_index=? AND is_stable=1 AND is_on_main_chain=1 AND pow_type=? LIMIT 1",
				[round_index, constants.POW_TYPE_TRUSTME], function(rows){
					if(rows.length >= 1) {
						conn.query("select 1 from units join unit_authors using(unit) where address=? and pow_type=? and round_index=?",
						[my_address, constants.POW_TYPE_COIN_BASE, round_index], function(rows){
							if(rows.length<=0){
								round.getCoinbaseByRoundIndexAndAddress(conn, round_index-1, my_address, function(coinbase_amount){
									conn.release();
									if(coinbase_amount===0){
										return console.log("No coinbase earned")
									}
									composer.composeCoinbaseJoint(my_address, round_index, coinbase_amount, wallet.signer, callbacks);
								})
							} else {
								conn.release();
							}
						})
					} else {
						conn.release();
					}
				})
			} else {
				conn.release();
			}
		});
	})
}

setTimeout(function(){
	wallet.readKeys(function(mnemonic_phrase, passphrase){
		var mnemonic = new Mnemonic(mnemonic_phrase);
		// global
		xPrivKey = mnemonic.toHDPrivateKey(passphrase);
		var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
		// read the id of the only wallet
		readSingleWallet(function(wallet){
			// global
			wallet_id = wallet;
			var device = require('trustnote-pow-common/wallet/device.js');
			device.setDevicePrivateKey(devicePrivKey);
			let my_device_address = device.getMyDeviceAddress();
			db.query("SELECT 1 FROM extended_pubkeys WHERE device_address=?", [my_device_address], function(rows){
				if (rows.length > 1)
					throw Error("more than 1 extended_pubkey?");
				if (rows.length === 0)
					return setTimeout(function(){
						console.log('passphrase is incorrect');
						process.exit(0);
					}, 1000);
				require('trustnote-pow-common/wallet/wallet.js'); // we don't need any of its functions but it listens for hub/* messages
				eventBus.emit('headless_wallet_ready');
				setTimeout(logging.replaceConsoleLog, 1000);
				setTimeout(logging.replaceConsoleInfo, 1000);
				
			});
		});
	});
}, 1000);

// The below events can arrive only after we read the keys and connect to the hub.
// The event handlers depend on the global var wallet_id being set, which is set after reading the keys

eventBus.on('headless_wallet_ready', function(){
	var network = require('trustnote-pow-common/p2p/network.js');
	var composer = require('trustnote-pow-common/unit/composer.js');
	
	if (conf.permanent_pairing_secret)
		db.query(
			"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
			[conf.permanent_pairing_secret]
		);
		
	if (!conf.admin_email || !conf.from_email){
		console.log("please specify admin_email and from_email in your "+desktopApp.getAppDataDir()+'/conf.json');
		process.exit(1);
	}

	readSingleAddress(function(address){
		my_address = address;
		//checkAndWitness();
		eventBus.on('new_joint', checkAndWitness); // new_joint event is not sent while we are catching up
	});
	
	eventBus.on('round_switch', function(round_index){
		bMining = false;
		bPowSent = false;
		pow.stopMining(round_index-1)
		console.log('=== Round Switch === : '+round_index);
	});


	/**
	 *	POW MOD
	 *	
	 *	@datetime	2018/10/11 2:39 PM	
	 *	start using version control
	 *
	 *
	 * 	[REMOTE SIDE]
	 * 		- data in variable oBody comes from remote client
	 * 	oBody.program		= { package.json }.name
	 *	oBody.program_version	= { package.json }.version
	 *
	 *
	 * 	[LOCAL SIDE]
	 * 		- data in variable conf stores in local from been loaded on boot
	 *	conf.clientName		= { conf.js }.clientName
	 *	conf.minClientVersion	= { conf.js }.minClientVersion
	 * 	conf.program		= { package.json }.name		//	loaded on boot
	 *	conf.program_version	= { package.json }.version	//	loaded on boot
	 *
	 */
	eventBus.on( 'peer_version', function( oWs, oBody )
	{
		var version = require('./lib/version.js')
		if ( oBody.program === conf.clientName )
		{
			//
			//	user specified conf.minClientVersion
			//
			if ( conf.minClientVersion &&
				version.compareVersions( oBody.program_version, conf.minClientVersion ) === '<' )
			{
				//
				//	just tell remote the conf.minClientVersion
				//
				network.sendJustsaying( oWs, 'new_version', { version : conf.minClientVersion } );
			}

			if ( version.compareVersions( oBody.program_version, conf.program_version ) === '<' )
			{
				//
				//	close the connection while the remote is out of date
				//	so, the remote will be forced to update
				//
				console.log(`*************\n***** Client: ${oWs.host} version is too low, will cancel the connection.\n*************`)
				oWs.close( 1000, "mandatory upgrade" );
			}
		}
		var library = require('trustnote-pow-common/package.json');
		if (version.compareVersions(oBody.library_version, library.version) === '>' ) {
			console.log(`*************\n***** Library: My Library version is too low.\n*************`)
		} else if (version.compareVersions(oBody.library_version, library.version) === '<' ) {
			console.log(`*************\n***** Library: ${oWs.host} library version is too low, will cancel the connection.\n*************`)
			oWs.close( 1000, "mandatory upgrade" );
		}
		last_round_index = oBody.last_round_index;
	});

	eventBus.on('updated_last_round_index_from_peers', function (nLastRoundIndexFromPeers){
		last_round_index = nLastRoundIndexFromPeers;
	})

	setInterval(function(){
		console.log(`Mining Status: ${bMining}, POW Status: ${bPowSent}  ready to checkTrustMEAndStartMinig`)
		round.getCurrentRoundIndexByDb(function(round_index){
			checkRoundAndComposeCoinbase(round_index);
			checkTrustMEAndStartMining(round_index);
		})
	},10*1000);

	eventBus.on("launch_pow", function(round_index) {
		checkTrustMEAndStartMining(round_index)
	})
	
	eventBus.on("pow_mined_gift", function(err, solution){
		if(err) {
			return onMiningError(err);
		}

		if(my_address == constants.FOUNDATION_ADDRESS) {
			bMining = false;
			return console.log('Foundation will not mine');
		}
		
		var gap = Date.now() - interval;
		console.log(`===POW cost: ${gap} ms===`)
		console.log('===Will compose POW joint===');
	
		const callbacks = composer.getSavingCallbacks({
			ifNotEnoughFunds: onMiningError,
			ifError: onMiningError,
			ifOk: function(objJoint){
				bMining = false;
				bPowSent = true;
				network.broadcastJoint(objJoint);
				logging.infoMiningSuccess(JSON.stringify(objJoint.unit.round_index));
				console.log('===Pow=== objJoin sent')
			}
		})
	
		db.takeConnectionFromPool(function(conn){
			round.getCurrentRoundIndex(conn, function(round_index){
				if(round_index < last_round_index) {
					conn.release();
					return console.log(`Last Round Index is ${ last_round_index }, will not mining`)
				}
				if(round_index != solution.round){
					conn.release();
					return console.log("Round switched won't compose pow with wrong round index")
				}
				round.checkIfPowUnitByRoundIndexAndAddressExists(conn, round_index, my_address, function(bExist) {
					if(bExist) {
						conn.release()
						bMining = false;
						bPowSent = true;
						return console.log('POW already sent');
					}
					conn.query("SELECT count(*) as count from units where pow_type=? and round_index=?", [constants.POW_TYPE_POW_EQUHASH, round_index], function(rows){
						conn.release()
						console.log(`Mining POW :${rows[0].count}`)
						if(rows[0].count >= 8) {
							bMining = false;
							bPowSent = true;
							return console.log('There is already more than 8 pow joints, will not compose another one')
						}
						composer.composePowJoint(my_address, round_index, solution.publicSeed, solution.bits, {hash:solution["hash"],nonce:solution["nonce"]}, wallet.signer, callbacks)
					})
				});
			})
		});
	})
	
	if(conf.bServeAsRpc){
		var rpc_service = require('./lib/rpc_service.js');
		eventBus.on('headless_wallet_ready', rpc_service.initRPC);
	}
});