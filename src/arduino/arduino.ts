/*--------------------------------------------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import * as constants from "../common/constants";
import * as util from "../common/util";
import * as Logger from "../logger/logger";
import * as settings from "./settings";

import { DeviceContext, IDeviceContext } from "../deviceContext";
import { BoardManager } from "./boardManager";

import { arduinoChannel } from "../common/outputChannel";

/**
 * Represent an Arduino application based on the official Arduino IDE.
 */
export class ArduinoApp {

    private _preferences: Map<string, string>;

    private _boardManager: BoardManager;

    /**
     * @param {IArduinoSettings} ArduinoSetting object.
     */
    constructor(private _settings: settings.IArduinoSettings) {
    }

    /**
     * Need refresh Arduino IDE's setting when starting up.
     * @param {boolean} force - Whether force initialzie the arduino
     */
    public async initialize(force: boolean = false) {
        if (force || !util.fileExistsSync(path.join(this._settings.packagePath, "package_index.json"))) {
            try {
                // Use the dummy package to initialize the Arduino IDE
                await this.installBoard("dummy", "dummy", "", false);
            } catch (ex) {
            }
        }
    }

    /**
     * Initialize the arduino library.
     */
    public async initializeLibrary() {
        if (!util.fileExistsSync(path.join(this._settings.packagePath, "library_index.json"))) {
            try {
                // Use the dummy library to initialize the Arduino IDE
                await this.installLibrary("dummy", "", false);
            } catch (ex) {
            }
        }
    }

    /**
     * Set the Arduino preferences value.
     * @param {string} key - The preference key
     * @param {string} value - The preference value
     */
    public async setPref(key, value) {
        try {
            await util.spawn(this._settings.commandPath,
                null,
                ["--pref", `${key}=${value}`]);
        } catch (ex) {
        }
    }

    public async upload() {
        let dc = DeviceContext.getIntance();
        const boardDescriptor = this.getBoardDescriptorString(dc);
        if (!boardDescriptor) {
            return;
        }
        arduinoChannel.show();

        arduinoChannel.start(`Upload sketch - ${dc.sketch}`);

        await vscode.commands.executeCommand("arduino.closeSerialMonitor", dc.port);

        const appPath = path.join(vscode.workspace.rootPath, dc.sketch);
        const args = ["--upload", "--board", boardDescriptor, "--port", dc.port, appPath];
        if (this._settings.logLevel === "verbose") {
            args.push("--verbose");
        }
        await util.spawn(this._settings.commandPath, arduinoChannel.channel, args).then((result) => {
            arduinoChannel.end(`Uploaded the sketch: ${dc.sketch}${os.EOL}`);
        }, (reason) => {
            arduinoChannel.error(`Exit with code=${reason.code}${os.EOL}`);
        });
    }

    public async verify() {
        let dc = DeviceContext.getIntance();
        const boardDescriptor = this.getBoardDescriptorString(dc);
        if (!boardDescriptor) {
            return;
        }
        arduinoChannel.start(`Verify sketch - ${dc.sketch}`);
        const appPath = path.join(vscode.workspace.rootPath, dc.sketch);
        const args = ["--verify", "--board", boardDescriptor, "--port", dc.port, appPath];
        if (this._settings.logLevel === "verbose") {
            args.push("--verbose");
        }
        arduinoChannel.show();
        await util.spawn(this._settings.commandPath, arduinoChannel.channel, args).then((result) => {
            arduinoChannel.end(`Finished verify sketch - ${dc.sketch}${os.EOL}`);
        }, (reason) => {
            arduinoChannel.error(`Exit with code=${reason.code}${os.EOL}`);
        });
    }

    public addLibPath(libraryPath: string) {
        let libPaths;
        if (libraryPath) {
            libPaths = [libraryPath];
        } else {
            libPaths = this.getDefaultPackageLibPaths();
        }

        const configFilePath = path.join(vscode.workspace.rootPath, constants.CPP_CONFIG_FILE);
        let deviceContext = null;
        if (!util.fileExistsSync(configFilePath)) {
            util.mkdirRecursivelySync(path.dirname(configFilePath));
            deviceContext = {};
        } else {
            deviceContext = util.tryParseJSON(fs.readFileSync(configFilePath, "utf8"));
        }
        if (!deviceContext) {
            Logger.notifyAndThrowUserError("arduinoFileError", new Error(constants.messages.ARDUINO_FILE_ERROR));
        }

        deviceContext.configurations = deviceContext.configurations || [];
        let configSection = null;
        deviceContext.configurations.forEach((section) => {
            if (section.name === util.getCppConfigPlatform()) {
                configSection = section;
                configSection.browse = configSection.browse || {};
                configSection.browse.limitSymbolsToIncludedHeaders = false;
            }
        });

        if (!configSection) {
            configSection = {
                name: util.getCppConfigPlatform(),
                includePath: [],
                browse: { limitSymbolsToIncludedHeaders: false },
            };
            deviceContext.configurations.push(configSection);
        }

        libPaths.forEach((childLibPath) => {
            childLibPath = path.resolve(path.normalize(childLibPath));
            if (configSection.includePath && configSection.includePath.length) {
                for (let existingPath of configSection.includePath) {
                    if (childLibPath === path.resolve(path.normalize(existingPath))) {
                        return;
                    }
                }
            } else {
                configSection.includePath = [];
            }
            configSection.includePath.push(childLibPath);
        });

        fs.writeFileSync(configFilePath, JSON.stringify(deviceContext, null, 4));
    }

    /**
     * Install arduino board package based on package name and platform hardware architecture.
     */
    public async installBoard(packageName: string, arch: string, version: string = "", showOutput: boolean = true) {
        arduinoChannel.show();
        arduinoChannel.start(`Install package - ${packageName}...`);
        await util.spawn(this._settings.commandPath,
            showOutput ? arduinoChannel.channel : null,
            ["--install-boards", `${packageName}:${arch}${version && ":" + version}`]);
        arduinoChannel.end(`Installed board package - ${packageName}${os.EOL}`);
    }

    public uninstallBoard(boardName: string, packagePath: string) {
        arduinoChannel.start(`Uninstall board package - ${boardName}...`);
        util.rmdirRecursivelySync(packagePath);
        arduinoChannel.end(`Uninstalled board package - ${boardName}${os.EOL}`);
    }

    public async installLibrary(libName: string, version: string = "", showOutput: boolean = true) {
        arduinoChannel.show();
        arduinoChannel.start(`Install library - ${libName}`);
        await util.spawn(this._settings.commandPath,
            showOutput ? arduinoChannel.channel : null,
            ["--install-library", `${libName}${version && ":" + version}`]);

        arduinoChannel.end(`Installed libarray - ${libName}${os.EOL}`);
    }

    public uninstallLibrary(libName: string, libPath: string) {
        arduinoChannel.start(`Remove library - ${libName}`);
        util.rmdirRecursivelySync(libPath);
        arduinoChannel.end(`Removed library - ${libName}${os.EOL}`);
    }

    public getDefaultPackageLibPaths(): string[] {
        let result = [];
        let boardDescriptor = this._boardManager.currentBoard;
        if (!boardDescriptor) {
            return result;
        }
        let toolsPath = boardDescriptor.platform.rootBoardPath;
        if (util.directoryExistsSync(path.join(toolsPath, "cores"))) {
            let coreLibs = fs.readdirSync(path.join(toolsPath, "cores"));
            if (coreLibs && coreLibs.length > 0) {
                coreLibs.forEach((coreLib) => {
                    result.push(path.normalize(path.join(toolsPath, "cores", coreLib)));
                });
            }
        }
        return result;
    }

    public get preferences() {
        if (!this._preferences) {
            this.loadPreferences();
        }
        return this._preferences;
    }

    public get boardManager() {
        return this._boardManager;
    }

    public set boardManager(value: BoardManager) {
        this._boardManager = value;
    }

    private loadPreferences() {
        this._preferences = new Map<string, string>();
        const lineRegex = /(\S+)=(\S+)/;

        const rawText = fs.readFileSync(path.join(this._settings.packagePath, "preferences.txt"), "utf8");
        const lines = rawText.split("\n");
        lines.forEach((line) => {
            if (line) {
                let match = lineRegex.exec(line);
                if (match && match.length > 2) {
                    this._preferences.set(match[1], match[2]);
                }
            }
        });
    }

    private getBoardDescriptorString(deviceContext: IDeviceContext): string {
        let boardDescriptor = this.boardManager.currentBoard;
        if (!boardDescriptor) {
            Logger.notifyUserError("getBoardDescriptorError", new Error(constants.messages.NO_BOARD_SELECTED));
            return;
        }
        let boardString = `${boardDescriptor.platform.package.name}:${boardDescriptor.platform.architecture}:${boardDescriptor.board}`;
        return boardString;
    }
}
