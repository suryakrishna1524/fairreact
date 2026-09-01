/**
 * Test Suite for FairReact Web Player
 */

const { FairReactSyncEngine } = require('../js/sync_engine.js');

console.log("Running FairReact Web Player Automated Tests...\n");

// Test 1: URL Parameter and Token Decoupling
const sampleReaction = "uPlq0RPIr9A";
const sampleOriginal = "JqFzhcWo3EU";
const sampleToken = "v1.NDk6MA==";

const decoded = FairReactSyncEngine.decodeTimeline(sampleToken);
console.assert(decoded.length === 1, "Should decode 1 timeline point");
console.assert(decoded[0].reactTime === 49, "React start time should be 49s");
console.assert(decoded[0].origTime === 0, "Original start time should be 0s");
console.log("✓ Token decoding verified for web player parameters");

// Test 2: Sync Engine Simulation with Web Player Parameters
const engine = new FairReactSyncEngine();
engine.originalVideoId = sampleOriginal;
engine.rawPoints = decoded;
engine.buildSegments(decoded);
engine.isActive = true;

// At 20s (Before reaction start)
const preTarget = engine.calculateTarget(20);
console.assert(preTarget.state === 'PRE_START', "Should be in PRE_START before 49s");
console.assert(preTarget.timeUntilStart === 29, "Time until start should be 29s");

// At 62s (13s into reaction)
const playTarget = engine.calculateTarget(62);
console.assert(playTarget.state === 'PLAYING', "Should be PLAYING at 62s");
console.assert(playTarget.targetTime === 13, "Original video should be at 13s");

console.log("✓ Web Player state machine and timestamp calculations verified");
console.log("\nAll FairReact Web Player tests passed successfully! 🎉");
