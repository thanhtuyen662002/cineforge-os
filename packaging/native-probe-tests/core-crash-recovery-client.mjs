import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CoreService } from '../../core/core.mjs';

// A fresh Node process after the parent independently observes the crashed
// Core exit. Private fixture data cannot authorize production activation.
export async function exerciseCoreCrashRecovery(checkpointPath) {
  const image = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.equal(image.schema, 'OWNED_CORE_CRASH_FIXTURE_V1');
  if(image.workflow)return exerciseWorkflowCrashRecovery(image);
  const root = path.resolve(image.root);
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'cineforge-core-native-fixture-')));
  for (const file of [image.options.dbPath,image.options.assetStorePath,image.options.rendererToolchainRoot,image.options.rendererToolchainManifest,
    ...image.files.map(row=>row.file),...image.stages.map(row=>row.temp_path)]) assert.ok(path.resolve(file).startsWith(root+path.sep));
  const before = new DatabaseSync(image.options.dbPath, { readOnly: true });
  try {
    assert.equal(before.prepare('SELECT status FROM commands WHERE id=?').get(image.command.id).status,'EXECUTING');
    before.exec("VACUUM INTO '"+path.join(root,'pre-recovery.sqlite3').replaceAll("'","''")+"'");
  } finally { before.close(); }
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const options = { ...image.options, mediaProbeTrustSource: () => { loads++; const policyBytes=Buffer.from(image.policy,'base64');
    return { envelopeBytes:Buffer.from(image.envelope,'base64'),trustPolicyBytes:policyBytes,
      trustContext:{nowUtcMs:Date.now(),minimumPolicyEpoch:1,policySha256:digest(policyBytes),timeHealth:'TRUSTED',trustFreshness:'FRESH'} }; } };
  let loads=0; let core=new CoreService(options);
  try {
    assert.equal(loads,0,'Startup recovery may not load tool authority');
    for (const [table,rows] of Object.entries(image.canonical)) assert.deepEqual(JSON.parse(JSON.stringify(core.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),rows,table);
    assert.deepEqual(JSON.parse(JSON.stringify(core.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').all(image.command.id))),image.stages);
    for (const row of image.files) assert.equal(fs.existsSync(row.file) ? digest(fs.readFileSync(row.file)) : null,row.hash);
    const command=core.db.prepare('SELECT * FROM commands WHERE id=?').get(image.command.id);
    assert.equal(command.status,'PARTIAL'); const receipt=JSON.parse(command.result_json);
    assert.equal(receipt.contract,'PREPARED_MEDIA_PROBE_COMMAND_RECOVERY_V1');
    assert.equal(receipt.outcome,'UNKNOWN'); assert.equal(receipt.physical_tree,'UNKNOWN'); assert.equal(receipt.binding_pin_state,'UNKNOWN');
    assert.equal(JSON.stringify(receipt).includes(root),false);
    const completed=['CANONICAL','RELEASED'].includes(image.phase);
    const job=core.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(image.job.id);
    const attempt=core.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(image.attempt.id);
    assert.equal(job.state,completed?'COMPLETED':'UNKNOWN'); assert.equal(job.needs_user,1);
    assert.equal(attempt.state,completed?'SUCCEEDED':'ABANDONED');
    for(const field of ['authorization_id','core_owner_epoch','fencing_token','worker_instance_id','input_envelope_hash','output_envelope_hash',
      'stdout_bytes','stderr_bytes','cpu_time_ms','memory_peak_bytes'])assert.equal(attempt[field],image.attempt[field],field);
    assert.equal(job.current_attempt_id,completed?image.attempt.id:null); assert.equal(job.fencing_token,completed?image.attempt.fencing_token:null);
    assert.equal(Boolean(receipt.historical_technical_metadata_id),completed);
    const changes=core.db.prepare('SELECT total_changes() AS n').get().n;
    assert.deepEqual(await core.dispatchMediaProbeAttempt(image.request),receipt);
    assert.equal(core.db.prepare('SELECT total_changes() AS n').get().n,changes);
    const read=core.handle({api_version:'1',request_id:crypto.randomUUID(),method:'query.media_probe.metadata',
      params:{project_id:job.project_id,asset_revision_id:job.asset_revision_id}});
    assert.equal(read.ok,true,JSON.stringify(read.error)); assert.equal(read.result.outcome,completed?'PASS':'UNKNOWN');
    if(completed){assert.equal(read.result.next_step_key,'media_probe.next_step.recovery_required');assert.deepEqual(read.result.metadata.duration,{num:1,den:500});}
    else assert.equal(read.result.metadata,null);
    const stableCommands=core.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type LIKE 'PREPARED_RECONCILE_MEDIA_PROBE%'").get().n;
    const stages=core.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').all(image.command.id);
    core.close(); core=new CoreService(options);
    assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type LIKE 'PREPARED_RECONCILE_MEDIA_PROBE%'").get().n,stableCommands);
    assert.deepEqual(core.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').all(image.command.id),stages);
    assert.deepEqual(await core.dispatchMediaProbeAttempt(image.request),receipt);
    assert.deepEqual(core.reconcileMediaProbeDispatchCommands(),{recovered_commands:0,changed_jobs:0,retained_staging:0,batches:0,ready:true});
    return {core_recovery:'PASS',phase:image.phase,command_state:command.status,job_state:job.state,attempt_state:attempt.state,
      historical_metadata:completed,raw_custody_unchanged:true,canonical_unchanged:true,physical_tree:'UNKNOWN',binding_pin_state:'UNKNOWN',
      replay_read_only:true,restart_idempotent:true,certified_ffprobe:false};
  } finally {core?.close();}
}

async function exerciseWorkflowCrashRecovery(image){
  const root=path.resolve(image.root);assert.ok(root.startsWith(path.join(os.tmpdir(),'cineforge-core-native-fixture-')));
  for(const file of [image.options.dbPath,image.options.assetStorePath,image.options.rendererToolchainRoot,image.options.rendererToolchainManifest,
    ...image.files.map(r=>r.file),...image.stages.map(r=>r.temp_path)])assert.ok(path.resolve(file).startsWith(root+path.sep));
  const before=new DatabaseSync(image.options.dbPath,{readOnly:true});
  try{assert.equal(before.prepare('SELECT status FROM commands WHERE id=?').get(image.workflow.parent.id).status,'EXECUTING');
    before.exec("VACUUM INTO '"+path.join(root,'pre-recovery.sqlite3').replaceAll("'","''")+"'");
  }finally{before.close();}
  const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');let loads=0;
  const options={...image.options,mediaProbeTrustSource:()=>{loads++;const policyBytes=Buffer.from(image.policy,'base64');
    return{envelopeBytes:Buffer.from(image.envelope,'base64'),trustPolicyBytes:policyBytes,trustContext:{nowUtcMs:Date.now(),minimumPolicyEpoch:1,
      policySha256:digest(policyBytes),timeHealth:'TRUSTED',trustFreshness:'FRESH'}};}};
  let core=new CoreService(options);
  try{
    assert.equal(loads,0);
    for(const [table,rows]of Object.entries(image.canonical))assert.deepEqual(JSON.parse(JSON.stringify(core.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),rows,table);
    assert.deepEqual(JSON.parse(JSON.stringify(core.db.prepare('SELECT * FROM staging_objects WHERE command_id=?').all(image.command.id))),image.stages);
    for(const row of image.files)assert.equal(fs.existsSync(row.file)?digest(fs.readFileSync(row.file)):null,row.hash);
    const parent=core.db.prepare('SELECT * FROM commands WHERE id=?').get(image.workflow.parent.id);assert.equal(parent.status,'PARTIAL');
    const receipt=JSON.parse(parent.result_json);assert.equal(receipt.contract,'PREPARED_MEDIA_PROBE_WORKFLOW_RECOVERY_V1');
    assert.equal(receipt.state,'UNKNOWN');assert.equal(receipt.physical_tree,'UNKNOWN');assert.equal(receipt.binding_pin_state,'UNKNOWN');
    assert.equal(receipt.logical_only,true);assert.equal(receipt.needs_user,true);assert.equal(receipt.execution_started,true);
    const job=core.db.prepare('SELECT * FROM media_probe_jobs WHERE id=?').get(image.job.id);assert.equal(job.state,'COMPLETED');
    const attempt=core.db.prepare('SELECT * FROM media_probe_attempts WHERE id=?').get(image.attempt.id);
    assert.deepEqual(JSON.parse(JSON.stringify(attempt)),image.attempt);
    if(image.phase==='COMPLETED'){
      assert.deepEqual(JSON.parse(JSON.stringify(job)),image.job);
      assert.deepEqual(JSON.parse(JSON.stringify(core.db.prepare('SELECT * FROM commands WHERE id=?').get(image.command.id))),image.command);
    }else assert.equal(core.db.prepare('SELECT status FROM commands WHERE id=?').get(image.command.id).status,'PARTIAL');
    const changes=core.db.prepare('SELECT total_changes() AS n').get().n;
    assert.deepEqual(await core.runMediaProbeJob(image.workflow.request),receipt);assert.equal(loads,0);
    assert.equal(core.db.prepare('SELECT total_changes() AS n').get().n,changes);
    const read=core.handle({api_version:'1',request_id:crypto.randomUUID(),method:'query.media_probe.metadata',
      params:{project_id:job.project_id,asset_revision_id:job.asset_revision_id}});
    assert.equal(read.ok,true,JSON.stringify(read.error));assert.equal(read.result.outcome,'PASS');assert.equal(read.result.needs_user,true);
    assert.equal(read.result.next_step_key,'media_probe.next_step.recovery_required');assert.deepEqual(read.result.metadata.duration,{num:1,den:500});
    const count=core.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type LIKE 'PREPARED_RECONCILE_MEDIA_PROBE%'").get().n;
    core.close();core=new CoreService(options);
    assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE command_type LIKE 'PREPARED_RECONCILE_MEDIA_PROBE%'").get().n,count);
    assert.deepEqual(await core.runMediaProbeJob(image.workflow.request),receipt);
    assert.deepEqual(core.reconcileMediaProbeWorkflows(),{recovered_workflows:0,batches:0,ready:true});
    return{core_recovery:'PASS',phase:image.phase,parent_command_state:'PARTIAL',job_state:job.state,attempt_state:attempt.state,
      prepared_core_workflow:true,canonical_unchanged:true,raw_custody_unchanged:true,child_journal_preserved:image.phase==='COMPLETED',
      physical_tree:'UNKNOWN',binding_pin_state:'UNKNOWN',replay_read_only:true,restart_idempotent:true,certified_ffprobe:false};
  }finally{core?.close();}
}
