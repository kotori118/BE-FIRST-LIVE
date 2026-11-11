import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';

const OWNER_UID = 'xBt1XGXQjUg0UI9opk18Y76bucQ2';
const PATH = 'diagnostics/firestoreConnection';
const sample = () => ({ message: 'BE-FIRST-LIVE connection test', checkedAt: serverTimestamp() });
let env;
const ownerDb = () => env.authenticatedContext(OWNER_UID, { firebase: { sign_in_provider: 'google.com' } }).firestore();
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-live-connection', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => env.cleanup());

test('owner can save one test record with a server timestamp and read it', async () => {
  const ref = doc(ownerDb(), PATH);
  await assertSucceeds(runTransaction(ref.firestore, async tx => { await tx.get(ref); tx.set(ref, sample()); }));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, sample()));
});
test('anonymous reads, writes and deletes are rejected', async () => {
  const ref = doc(env.unauthenticatedContext().firestore(), PATH);
  await assertFails(getDoc(ref)); await assertFails(setDoc(ref, sample())); await assertFails(deleteDoc(ref));
});
test('other Google user cannot read or write', async () => {
  const db = env.authenticatedContext('another-user', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  await assertFails(getDoc(doc(db, PATH))); await assertFails(setDoc(doc(db, PATH), sample()));
});
test('matching UID with a non-Google provider is rejected', async () => {
  const db = env.authenticatedContext(OWNER_UID, { firebase: { sign_in_provider: 'password' } }).firestore();
  await assertFails(getDoc(doc(db, PATH))); await assertFails(setDoc(doc(db, PATH), sample()));
});
test('client timestamps and extra personal fields are rejected', async () => {
  const ref = doc(ownerDb(), PATH);
  await assertFails(setDoc(ref, { message: 'BE-FIRST-LIVE connection test', checkedAt: Timestamp.fromMillis(1) }));
  await assertFails(setDoc(ref, { ...sample(), seat: 'not-allowed' }));
  await assertFails(setDoc(ref, { message: 'not-allowed', checkedAt: serverTimestamp() }));
});
test('live and other diagnostic paths stay closed, even to owner', async () => {
  const db = ownerDb();
  for (const path of ['diagnostics/other', 'datasets/test', 'appMeta/active']) {
    await assertFails(getDoc(doc(db, path))); await assertFails(setDoc(doc(db, path), sample()));
  }
  await assertFails(getDocs(collection(db, 'diagnostics')));
});
test('catalog and sync status are read-only for owner and hidden from everyone else', async () => {
  const owner = ownerDb(), guest = env.unauthenticatedContext().firestore();
  for (const path of ['universeSongs/test', 'syncStatus/current']) {
    await assertSucceeds(getDoc(doc(owner, path)));
    await assertFails(setDoc(doc(owner, path), sample()));
    await assertFails(getDoc(doc(guest, path)));
  }
  await assertSucceeds(getDocs(collection(owner, 'universeSongs')));
  const other = env.authenticatedContext('other-google', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  await assertFails(getDocs(collection(other, 'universeSongs')));
});
test('owner can delete the disposable connection test record', async () => {
  await assertSucceeds(deleteDoc(doc(ownerDb(), PATH)));
});
test('startup sync requests require owner, fresh server time and PENDING only',async()=>{
 const owner=doc(ownerDb(),'syncRequests/current'),value=()=>({requestId:'00000000-0000-4000-8000-000000000001',requestedAt:serverTimestamp(),state:'PENDING'});
 await assertSucceeds(setDoc(owner,value()));
 await assertFails(setDoc(owner,{...value(),state:'DONE'}));
 await assertFails(setDoc(owner,{...value(),requestedAt:Timestamp.fromMillis(1)}));
 await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'syncRequests/current'),value()));
});
