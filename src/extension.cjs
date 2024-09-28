const vscode = require("vscode");
const { LanguageClient, AbstractMessageReader, AbstractMessageWriter } =
  require("vscode-languageclient/node");
const { WasmServer, instantiate } = require("./dist/mf2lsp.generated.cjs");

/**
 * @typedef Configuration
 * @property {ServerConfiguration} server
 */

/**
 * @typedef ServerConfiguration
 * @property {string} path
 * @property {{ enabled: boolean, version: string }} update
 */

exports.Mf2Extension = class Mf2Extension {
  /** @type {vscode.ExtensionContext} */
  #context;

  /** @type {Configuration} */
  #configuration;

  /** @type {LanguageClient | null} */
  #ls = null;
  /** @type {vscode.LogOutputChannel} */
  #outputChannel;

  /** @param {vscode.ExtensionContext} context */
  async activate(context) {
    this.#context = context;
    this.#configuration = /** @type {any} */ (
      vscode.workspace.getConfiguration("mf2")
    );

    vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (e.affectsConfiguration("mf2")) {
          this.#configuration = /** @type {any} */ (
            vscode.workspace.getConfiguration("mf2")
          );
          await this.#stopLanguageServer();
          await this.#startLanguageServer();
        }
      },
      this,
      context.subscriptions,
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("mf2.restart", async () => {
        await this.#stopLanguageServer();
        await this.#startLanguageServer();
      }),
    );

    this.#outputChannel = vscode.window.createOutputChannel(
      "MessageFormat 2",
      { log: true },
    );
    context.subscriptions.push(this.#outputChannel);

    await this.#startLanguageServer();
  }

  async deactivate() {
    await this.#stopLanguageServer();
  }

  async #startLanguageServer() {
    if (this.#ls) return;

    if (!this.#configuration.server.path) {
      vscode.window.showErrorMessage(
        "MessageFormat 2 Language Server could not start up because no path to the language server binary was set, and automatic downloading is disabled.",
      );
      return;
    }

    await instantiate();

    /** @type {import("vscode-languageclient/node").ServerOptions} */
    const serverOptions = async () => {
      const io = new WasmIO();
      /** @type {import("vscode-languageclient/node").MessageTransports} */
      return {
        reader: new WasmMessageReader(io),
        writer: new WasmMessageWriter(io),
      };
    };

    /** @type {import("vscode-languageclient").LanguageClientOptions} */
    const clientOptions = {
      documentSelector: [{ scheme: "file", language: "mf2" }],
      outputChannel: this.#outputChannel,
    };

    this.#ls = new LanguageClient(
      "mf2lsp",
      "MessageFormat 2 Language Server",
      serverOptions,
      clientOptions,
    );

    await this.#ls.start();
  }

  async #stopLanguageServer() {
    await this.#ls?.stop(2000);
    this.#ls = null;
  }
};

class WasmIO {
  /** @type {import("./dist/mf2lsp.generated.cjs").WasmServer} */
  #server;

  /** @type {import("vscode-languageclient/node").DataCallback | null} */
  #cb;

  constructor() {
    this.#server = new WasmServer();
  }

  /**
   * @param {import("vscode-languageclient/node").DataCallback} callback
   * @returns {import("vscode-languageclient/node").Disposable}
   */
  listen(callback) {
    this.#cb = callback;
    return {
      dispose: () => {
        this.#cb = null;
      },
    };
  }

  send(msg) {
    const done = this.#server.write(msg);
    if (done) return;
    let message;
    while ((message = this.#server.read()) !== null) {
      this.#cb?.(message);
    }
  }

  dispose() {
    this.#server.free();
  }
}

class WasmMessageReader extends AbstractMessageReader {
  /** @type {WasmIO} */
  #io;

  /** @param {WasmIO} io */
  constructor(io) {
    super();
    this.#io = io;
  }

  /**
   * @param {import("vscode-languageclient/node").DataCallback} callback
   * @returns {import("vscode-languageclient/node").Disposable}
   */
  listen(callback) {
    return this.#io.listen(callback);
  }
}

class WasmMessageWriter extends AbstractMessageWriter {
  /** @type {WasmIO} */
  #io;

  /** @param {WasmIO} io */
  constructor(io) {
    super();
    this.#io = io;
  }

  async write(msg) {
    this.#io.send(msg);
  }

  end() {
  }
}
