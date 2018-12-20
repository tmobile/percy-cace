import { Component, ViewChild, HostListener, OnInit } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material';
import { Store, select } from '@ngrx/store';
import * as _ from 'lodash';

import { percyConfig, appPercyConfig } from 'config';
import { TreeNode } from 'models/tree-node';
import { ConfigFile, Configuration } from 'models/config-file';

import * as appStore from 'store';
import { PageLoad } from 'store/actions/editor.actions';
import { GetFileContentSuccess, SaveDraftSuccess } from 'store/actions/backend.actions';
import { YamlService } from 'services/yaml.service';

import { EditorComponent } from 'components/editor/editor.component';
import { AlertDialogComponent } from 'components/alert-dialog/alert-dialog.component';

import { MESSAGE_TYPES } from './constants';

declare var acquireVsCodeApi;
const vscode = acquireVsCodeApi();

@Component({
  selector: 'app-vscode-root',
  templateUrl: './vsapp.component.html',
  styleUrls: ['./vsapp.component.scss']
})
export class VSAppComponent implements OnInit {

  appName: string;
  fileName: string;
  editMode = false;
  envFileMode = false;

  fileSaving: ConfigFile;

  environments: string[];
  configuration = this.store.pipe(select(appStore.getConfiguration));

  isPageDirty$ = this.store.pipe(select(appStore.getIsPageDirty));
  isPageDirty = false;

  @ViewChild('editor') editor: EditorComponent;

  invalidYamlAlert: MatDialogRef<AlertDialogComponent>;

  fileContent: string;

  /**
   * creates the component
   * @param store the app store instance
   * @param dialog the mat dialog service
   * @param yamlService the yaml service
   */
  constructor(
    private store: Store<appStore.AppState>,
    private dialog: MatDialog,
    private yamlService: YamlService,
  ) { }

  /**
   * Initialize component.
   */
  ngOnInit() {
    this.isPageDirty$.subscribe(res => {
      this.isPageDirty = res;
    });

    vscode.postMessage({
      type: MESSAGE_TYPES.INIT
    });
  }

  /**
   * Listener for post message from extension.
   * @param $event post message event
   */
  @HostListener('window:message', ['$event'])
  onMessage($event: any) {
    const message = $event.data; // The JSON data our extension sent

    if (message.type === MESSAGE_TYPES.SAVE) {
      if (this.isPageDirty) {
        this.saveConfig();
      }
      return;
    }

    if (message.type === MESSAGE_TYPES.SAVED) {
      this.editMode = true;
      this.isPageDirty = false;
      this.fileContent = message.fileContent;
      this.fileName = this.fileSaving.fileName = message.newFileName;
      this.store.dispatch(new PageLoad({ ...this.fileSaving, editMode: this.editMode }));
      this.store.dispatch(new SaveDraftSuccess(this.fileSaving));
      this.fileSaving = null;
      return;
    }

    if (message.type !== MESSAGE_TYPES.ACTIVATE) {
      return;
    }
    console.log(message);

    if (this.invalidYamlAlert) {
      this.invalidYamlAlert.close(true);
    }

    this.appName = message.appName;
    this.fileName = message.fileName;
    this.editMode = message.editMode;
    this.envFileMode = message.envFileMode;

    _.assign(percyConfig, message.percyConfig);

    // Set appPercyConfig
    _.keys(appPercyConfig).forEach(key => delete appPercyConfig[key]);
    _.assign(appPercyConfig, message.appPercyConfig);

    this.environments = [];
    if (message.envFileContent) {
      const envConfig = this.parseYaml(message.envFileContent, `${this.appName}/${percyConfig.environmentsFile}`);
      this.environments = _.map(_.get(envConfig.environments, 'children', <TreeNode[]>[]), child => child.key);
    }

    this.fileContent = message.fileContent;

    this.reset();
  }

  /**
   * Reset edit.
   */
  reset() {
    this.isPageDirty = !this.editMode;

    const file: ConfigFile = {
      fileName: this.fileName,
      applicationName: this.appName
    };

    this.store.dispatch(new PageLoad({ ...file, editMode: this.editMode }));

    if (!this.fileContent) {
      // Add new file, set an initial config
      file.modified = true;
      file.draftConfig = new Configuration();
      this.store.dispatch(new GetFileContentSuccess({ file, newlyCreated: true }));
    } else {
      file.originalConfig = this.parseYaml(this.fileContent, `${this.appName}/${this.fileName}`);
      this.store.dispatch(new GetFileContentSuccess({ file }));
    }
  }

  /**
   * Parse yaml. Will hanle error if any.
   * @param content the yaml content
   * @param filePath the file path
   */
  private parseYaml(content: string, filePath: string) {
    try {
      return this.yamlService.parseYamlConfig(content);
    } catch (err) {
      this.invalidYamlAlert = this.dialog.open(AlertDialogComponent, {
        data: {
          message: `Invalid yaml at ${filePath}`
        }
      });
      this.invalidYamlAlert.afterClosed().subscribe(res => {
        if (!res) {
          this.doClose();
        }
        this.invalidYamlAlert = null;
      });
      throw err;
    }
  }

  /**
   * Save config.
   */
  saveConfig() {
    this.editor.validate().subscribe(result => {
      if (!result.valid) {
        return;
      }

      const editorState = result.editorState;

      this.fileSaving = { ...editorState.configFile };
      this.fileSaving.draftConfig = editorState.configuration;

      vscode.postMessage({
        type: MESSAGE_TYPES.SAVE,
        editMode: this.editMode,
        envFileMode: this.envFileMode,
        fileContent: this.yamlService.convertTreeToYaml(editorState.configuration)
      });
    });
  }

  /**
   * Do close the webview panel.
   */
  private doClose() {
    vscode.postMessage({
      type: MESSAGE_TYPES.CLOSE
    });
  }
}
