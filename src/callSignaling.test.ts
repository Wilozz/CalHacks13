import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRoomCode,normalizeRoomCode} from './callSignaling';
test('six-character codes tolerate case, spaces and separators',()=>{
 assert.equal(validateRoomCode(' ab-c2 34 '),'ABC234');
 assert.equal(normalizeRoomCode('ab c234'),'ABC234');
});
test('rejects ambiguous characters, incomplete, long and old SDP codes',()=>{
 for(const code of ['', 'ABC23','ABC2345','AIC234','AOC234','ABC014','eyJ2ZXJzaW9uIjoxfQ==','../../'])assert.throws(()=>validateRoomCode(code));
});
