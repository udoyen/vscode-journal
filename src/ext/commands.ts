import { FileTemplate } from './conf';
import { Inject } from './../actions/inject';
// Copyright (C) 2017  Patrick Maué
// 
// This file is part of vscode-journal.
// 
// vscode-journal is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// vscode-journal is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with vscode-journal.  If not, see <http://www.gnu.org/licenses/>.
// 

'use strict';

import * as vscode from 'vscode';
import * as Q from 'q';
import * as J from '../.';
import * as moment from 'moment';
import { isNullOrUndefined, isString, isError } from 'util';

export interface Commands {
    processInput(): Q.Promise<vscode.TextEditor>
    showNote(): Q.Promise<vscode.TextEditor>
    showEntry(offset: number): Q.Promise<vscode.TextEditor>
    loadJournalWorkspace(): Q.Promise<void>
    //editJournalConfiguration(): Thenable<vscode.TextEditor>
}


export class JournalCommands implements Commands {

    /**
     *
     */
    constructor(public ctrl: J.Util.Ctrl) {
    }
    /**
     * Opens the editor for a specific day. Supported values are explicit dates (in ISO format),
     * offsets (+ or - as prefix and 0) and weekdays (next wednesday) 
     */
    public processInput(): Q.Promise<vscode.TextEditor> {
        this.ctrl.logger.trace("Entering processInput() in ext/commands.ts")

        let deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();
        let inputVar: J.Model.Input = null;
        let docVar: vscode.TextDocument = null;

        this.ctrl.ui.getUserInput("Enter day or memo (with flags) ")
            .then((inputString: string) => this.ctrl.parser.parseInput(inputString))
            .then((input: J.Model.Input) => this.loadPageForInput(input))
            .then(document => this.ctrl.ui.showDocument(document))
            .then((editor: vscode.TextEditor) => deferred.resolve(editor))
            .catch((error: any) => {
                if (error != 'cancel') {
                    J.Util.error("Failed to process input.");
                    deferred.reject(error);
                }

            });
        return deferred.promise;
    }

    /**
     * Called by command 'Journal:open'. Opens a new windows with the Journal base directory as root. 
     *
     * @returns {Q.Promise<void>}
     * @memberof JournalCommands
     */
    public loadJournalWorkspace(): Q.Promise<void> {
        this.ctrl.logger.trace("Entering loadJournalWorkspace() in ext/commands.ts")

        var deferred: Q.Deferred<void> = Q.defer<void>();

        let path = vscode.Uri.file(this.ctrl.config.getBasePath());
        vscode.commands.executeCommand('vscode.openFolder', path, true)
            .then(success => {
                deferred.resolve(null);
            },
                error => {
                    console.error("[Journal]", "Failed to open journal workspace.", error);
                    this.showError("Failed to open journal workspace.");
                    deferred.reject(error);
                });

        return deferred.promise;
    }

    /**
     * Called by command 'Journal:open'. Opens a new windows with the Journal base directory as root. 
     *
     * @returns {Q.Promise<void>}
     * @memberof JournalCommands
     */
    public printTime(): Q.Promise<void> {
        this.ctrl.logger.trace("Entering printTime() in ext/commands.ts")

        return Q.Promise<void>((resolve, reject) => {
            let editor: vscode.TextEditor = vscode.window.activeTextEditor;

            // Todo: identify scope of the active editor

            this.ctrl.config.getTimeStringTemplate().then(tpl => {
                let locale = this.ctrl.config.getLocale();
                return J.Util.formatDate(new Date(), tpl.template, locale);
            }).then((str: string) => {
                let currentPosition: vscode.Position = editor.selection.active;
                this.ctrl.inject.injectString(editor.document, str, currentPosition);
            })

        });

    }

    /**
     * Called by command 'Journal:printDuration'. Requires three selections (three active cursors) in current document. It identifies
     * which of the selections are times (in the format hh:mm or glued like "1223") and where to print the duration (in decimal form). 
     * For now the duration is always printing hours
     *
     * @returns {Q.Promise<void>}
     * @memberof JournalCommands
     */
     public computeAndPrintDuration(): Q.Promise<void> {
        this.ctrl.logger.trace("Entering computeAndPrintDuration() in ext/commands.ts")

        return Q.Promise<void>((resolve, reject) => {
            try {
                let editor: vscode.TextEditor = vscode.window.activeTextEditor;
                let regExp: RegExp = /\d{1,2}:?\d{0,2}(?:\s?(?:am|AM|pm|PM))?|\s/

                if (editor.selections.length != 3)
                    throw new Error("To compute the duration, you have to select the two times (or dates) in your text as well as the location where to print it. ")

                // 
                let start: moment.Moment;
                let end: moment.Moment;
                let target: vscode.Position;

                let tpl = this.ctrl.config.getTimeString();



                editor.selections.forEach((selection: vscode.Selection) => {
                    let range: vscode.Range = editor.document.getWordRangeAtPosition(selection.active, regExp);

                    if (isNullOrUndefined(range)) {
                        target = selection.active; 
                        return;
                    }


                    // try to format into date
                    let text = editor.document.getText(range);
                    let time: moment.Moment;

                    time = moment(text, tpl);
                    if (!time.isValid()) {
                        // parsing glued hours
                        time = moment(text, "hmm");
                    }

                    if (isNullOrUndefined(start)) start = time;
                    else if (start.isAfter(time)) {
                        end = start;
                        start = time;
                    } else {
                        end = time;
                    }
                })

                if(isNullOrUndefined(start)) reject("No valid start time selected"); 
                else if(isNullOrUndefined(end)) reject("No valid end time selected"); 
                else if(isNullOrUndefined(target)) reject("No valid target selected for printing the duration.");   
                else {
                    let duration = moment.duration(start.diff(end)); 
                    let formattedDuration = Math.abs(duration.asHours()).toFixed(2); 
    
    
                    this.ctrl.inject.injectString(editor.document, formattedDuration,  target);
                    resolve(null);    
                }





            } catch (error) {
                reject(error);
            }


        });
    }








    /**
     * Creates a new file in a subdirectory with the current day of the month as name.
     * Shows the file to let the user start adding notes right away.
     *
     * @returns {Q.Promise<vscode.TextEditor>}
     * @memberof JournalCommands
     */
    public showNote(): Q.Promise<vscode.TextEditor> {
        this.ctrl.logger.trace("Entering showNote() in ext/commands.ts")

        var deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();

        this.ctrl.ui.getUserInput("Enter title for new note")
            .then((inputString: string) => this.ctrl.parser.parseInput(inputString))
            .then((input: J.Model.Input) =>
                Q.all([
                    this.ctrl.parser.resolveNotePathForInput(input),
                    this.ctrl.inject.buildNoteContent(input)
                ])
            )
            .then(([path, content]) => this.ctrl.reader.loadNote(path, content))
            .then((doc: vscode.TextDocument) => this.ctrl.ui.showDocument(doc))
            .then((editor: vscode.TextEditor) => deferred.resolve(editor))
            .catch(reason => {
                if (reason != 'cancel') {
                    console.error("[Journal]", "Failed to get file, Reason: ", reason);
                    this.showError("Failed to create and load notes");
                }
                deferred.reject(reason);
            })
            .done();

        return deferred.promise;
    }

    /**
     * Implements commands "yesterday", "today", "yesterday", where the input is predefined (no input box appears)
     * @param offset 
     */
    public showEntry(offset: number): Q.Promise<vscode.TextEditor> {
        this.ctrl.logger.trace("Entering showEntry() in ext/commands.ts")

        var deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();

        let input = new J.Model.Input();
        input.offset = offset;

        this.loadPageForInput(input)
            .then((doc: vscode.TextDocument) => this.ctrl.ui.showDocument(doc))
            .then((editor: vscode.TextEditor) => deferred.resolve(editor))
            .catch((error: any) => {
                if (error != 'cancel') {
                    console.error("[Journal]", "Failed to get file, Reason: ", error);

                }
                deferred.reject(error);
            })
            .done();

        return deferred.promise;
    }

    /*
    public editJournalConfiguration(): Q.Promise<vscode.TextEditor> {
        let deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();
        this.ctrl.ui.pickConfigToEdit()
            .then(filepath => this.ctrl.VSCode.loadTextDocument(filepath))
            .then(document => this.ctrl.ui.showDocument(document))
            .then(editor => deferred.resolve(editor))
            .catch(error => {
                if (error != 'cancel') {
                    console.error("[Journal]", "Failed to get file, Reason: ", error);
                    this.showError("Failed to create and load notes");

                }
                deferred.reject(error);
            })

        return deferred.promise;
    } */


    public showError(error: string | Q.Promise<string> | Error): void {

        if (Q.isPromise(error)) {
            (<Q.Promise<string>>error).then((value) => {
                // conflict between Q.IPromise and vscode.Thenable
                vscode.window.showErrorMessage(value);
            });
        };

        if (isString(error)) {
            vscode.window.showErrorMessage(error);
        };

        if (isError(error)) {
            vscode.window.showErrorMessage(error.message);
        }


    }


    private loadPageForInput(input: J.Model.Input): Q.Promise<vscode.TextDocument> {
        this.ctrl.logger.trace("Entering loadPageForInput() in ext/commands.ts")


        let deferred: Q.Deferred<vscode.TextDocument> = Q.defer<vscode.TextDocument>();

        this.ctrl.reader.loadEntryForOffset(input.offset)
            .then((doc: vscode.TextDocument) => this.ctrl.inject.injectInput(doc, input))
            .then((doc: vscode.TextDocument) => deferred.resolve(doc))
            .catch(error => deferred.reject(error))
            .done();


        return deferred.promise;
    }
}
