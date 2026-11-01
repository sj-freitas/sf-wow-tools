import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identifyPostFile } from './post-files';

const PDF = Buffer.from('%PDF-1.7 rest');
const ZIP = Buffer.from('PK\x03\x04rest', 'latin1');

describe('identifyPostFile', () => {
  it('recognises the allowed kinds by extension and content', () => {
    assert.deepEqual(identifyPostFile('Raid rules.pdf', PDF), {
      fileName: 'Raid rules.pdf',
      contentType: 'application/pdf',
    });
    assert.equal(identifyPostFile('a.zip', ZIP)?.contentType, 'application/zip');
    assert.equal(identifyPostFile('a.csv', Buffer.from('x,y\n1,2'))?.contentType, 'text/csv');
    assert.equal(identifyPostFile('a.txt', Buffer.from('héllo'))?.contentType, 'text/plain');
    assert.equal(identifyPostFile('a.mp3', Buffer.from('ID3rest'))?.contentType, 'audio/mpeg');
    assert.equal(
      identifyPostFile('a.wav', Buffer.from('RIFF\0\0\0\0WAVE'))?.contentType,
      'audio/wav',
    );
  });

  it('refuses other extensions, whatever the content', () => {
    for (const name of ['setup.exe', 'run.bat', 'page.html', 'x.svg', 'noextension', 'a.pdf.exe']) {
      assert.equal(identifyPostFile(name, PDF), null, name);
    }
    assert.equal(identifyPostFile('constructor', PDF), null);
    assert.equal(identifyPostFile('a.constructor', PDF), null);
  });

  it('refuses content that does not match the extension', () => {
    assert.equal(identifyPostFile('setup.pdf', Buffer.from('MZ\x90\0')), null);
    assert.equal(identifyPostFile('setup.zip', PDF), null);
    assert.equal(identifyPostFile('setup.txt', Buffer.from('MZ\x90\0')), null);
  });

  it('cleans up the name', () => {
    const name = (original: string) => identifyPostFile(original, PDF)?.fileName;
    assert.equal(name('../../secret.PDF'), 'secret.pdf');
    assert.equal(name('C:\\Users\\me\\Règles du raid.pdf'), 'Règles du raid.pdf');
    assert.equal(name('a"b<c>\n.pdf'), 'a_b_c__.pdf');
    assert.equal(name('..hidden.pdf'), 'hidden.pdf');
    assert.equal(name('.pdf'), 'file.pdf');
    assert.equal(name(`${'x'.repeat(200)}.pdf`), `${'x'.repeat(80)}.pdf`);
  });
});
