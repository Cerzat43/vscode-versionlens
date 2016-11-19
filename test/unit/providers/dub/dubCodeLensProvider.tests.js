/* --------------------------------------------------------------------------------------------
 * Copyright (c) Peter Flannery. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from 'assert';
import * as semver from 'semver';
import * as path from 'path';
import * as vscode from 'vscode';
import { register, clear } from '../../../../src/common/di';
import { TestFixtureMap } from '../../../testUtils';
import { DubCodeLensProvider } from '../../../../src/providers/dub/dubCodeLensProvider';
import { dubDefaultDependencyProperties } from '../../../../src/providers/dub/config';
import { AppConfiguration } from '../../../../src/common/appConfiguration';
import { PackageCodeLens } from '../../../../src/common/packageCodeLens';
import { CommandFactory } from '../../../../src/providers/commandFactory';
import * as jsonParser from 'vscode-contrib-jsonc';

const jsonExt = vscode.extensions.getExtension('vscode.json');

describe("DubCodeLensProvider", () => {
  const testPath = path.join(__dirname, '../../../../..', 'test');
  const fixturePath = path.join(testPath, 'fixtures');
  const fixtureMap = new TestFixtureMap(fixturePath);

  let testProvider;
  let httpRequestMock = {};
  let appConfigMock;
  let defaultVersionPrefix;
  let defaultDubDependencyKeys = dubDefaultDependencyProperties;

  beforeEach(() => {
    clear();

    appConfigMock = new AppConfiguration();
    Object.defineProperty(appConfigMock, 'versionPrefix', { get: () => defaultVersionPrefix })
    Object.defineProperty(appConfigMock, 'dubDependencyProperties', { get: () => defaultDubDependencyKeys })

    register('semver', semver);
    register('jsonParser', jsonParser);
    register('httpRequest', httpRequestMock);
    register('appConfig', appConfigMock);
    register('commandFactory', new CommandFactory());

    // mock the config
    defaultVersionPrefix = '^';
    testProvider = new DubCodeLensProvider();
  });

  describe("provideCodeLenses", () => {

    it("returns empty array when the document json is invalid", () => {
      let fixture = fixtureMap.read('package-invalid.json');

      let testDocument = {
        getText: range => fixture.content
      };

      let codeLens = testProvider.provideCodeLenses(testDocument, null);
      assert.ok(codeLens instanceof Array, "codeLens should be an array.");
      assert.ok(codeLens.length === 0, "codeLens should be an empty array.");
    });

    it("returns empty array when the document text is empty", () => {
      let testDocument = {
        getText: range => ''
      };

      let codeLens = testProvider.provideCodeLenses(testDocument, null);
      assert.ok(codeLens instanceof Array, "codeLens should be an array.");
      assert.ok(codeLens.length === 0, "codeLens should be an empty array.");
    });

    it("returns empty array when the package has no dependencies", () => {
      let fixture = fixtureMap.read('package-no-deps.json');

      let testDocument = {
        getText: range => fixture.content
      };

      let codeLens = testProvider.provideCodeLenses(testDocument, null);
      assert.ok(codeLens instanceof Array, "codeLens should be an array.");
      assert.ok(codeLens.length === 0, "codeLens should be an empty array.");
    });

    it("returns array of given dependencies to be resolved", () => {
      let fixture = fixtureMap.read('package-with-deps.json');

      let testDocument = {
        getText: range => fixture.content,
        positionAt: offset => new vscode.Position(0, 0),
        fileName: fixture.basename
      };

      let codeLens = testProvider.provideCodeLenses(testDocument, null);
      assert.ok(codeLens instanceof Array, "codeLens should be an array.");
      assert.equal(codeLens.length, 5, "codeLens should be an array containing 5 items inc <update all>.");

      codeLens.slice(1)
        .forEach((entry, index) => {
          assert.equal(entry.package.name, `dep${index + 1}`, `dependency name should be dep${index + 1}.`);
        });
    });

  });

  describe("resolveCodeLens", () => {

    it("passes url to httpRequest.xhr", done => {
      const codeLens = new PackageCodeLens(null, null, { name: 'SomePackage', version: '1.2.3', isValidSemver: true }, null);
      httpRequestMock.xhr = options => {
        assert.equal(options.url, 'http://code.dlang.org/api/packages/SomePackage/latest', "Expected httpRequest.xhr(options.url) but failed.");
        done();
        return Promise.resolve({
          status: 200,
          responseText: null
        });
      };
      testProvider.resolveCodeLens(codeLens, null);
    });

    it("when dub does not return status 200 then codeLens should return ErrorCommand", done => {
      const codeLens = new PackageCodeLens(null, null, { name: 'SomePackage', version: '1.2.3', isValidSemver: true }, null);
      httpRequestMock.xhr = options => {
        return Promise.resolve({
          status: 404,
          responseText: 'Not found'
        });
      };

      testProvider.resolveCodeLens(codeLens, null).then(result => {
        assert.equal(result.command.title, 'Not found', "Expected command.title failed.");
        assert.equal(result.command.command, undefined);
        assert.equal(result.command.arguments, undefined);
        done();
      });
    });

    it("when null response object returned from dub then codeLens should return ErrorCommand", done => {
      const codeLens = new PackageCodeLens(null, null, { name: 'SomePackage', version: '1.2.3', isValidSemver: true }, null);

      httpRequestMock.xhr = options => {
        return Promise.resolve({
          status: 200,
          responseText: null
        });
      };

      testProvider.resolveCodeLens(codeLens, null).then(result => {
        assert.equal(result.command.title, 'Invalid object returned from server', "Expected command.title failed.");
        assert.equal(result.command.command, undefined);
        assert.equal(result.command.arguments, undefined);
        done();
      });

    });

    it("when response is an error object then codeLens should return ErrorCommand", done => {
      const codeLens = new PackageCodeLens(null, null, { name: 'SomePackage', version: '1.2.3', isValidSemver: true }, null);

      httpRequestMock.xhr = options => {
        return Promise.resolve({
          status: 200,
          responseText: '{"statusMessage": "Package not found"}'
        });
      };

      testProvider.resolveCodeLens(codeLens, null).then(result => {
        assert.equal(result.command.title, 'Invalid object returned from server', "Expected command.title failed.");
        assert.equal(result.command.command, undefined);
        assert.equal(result.command.arguments, undefined);
        done();
      });
    });

    it("when a valid response returned from dub and package version is 'not latest' then codeLens should return NewVersionCommand", done => {
      const codeLens = new PackageCodeLens(null, null, { name: 'SomePackage', version: '1.2.3', isValidSemver: true }, null);
      httpRequestMock.xhr = options => {
        return Promise.resolve({
          status: 200,
          responseText: '"3.2.1"'
        });
      };
      testProvider.resolveCodeLens(codeLens, null).then(result => {
        assert.equal(result.command.title, '⬆ ^3.2.1');
        assert.equal(result.command.command, '_versionlens.updateDependencyCommand');
        assert.equal(result.command.arguments[1], '"^3.2.1"');
        done();
      });
    });

  });

});