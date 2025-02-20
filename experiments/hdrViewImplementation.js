var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { ExtensionSupport } = ChromeUtils.import("resource:///modules/ExtensionSupport.jsm");
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { ExtensionUtils } = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");
var { ExtensionError } = ExtensionUtils;

class CustomHdrRow {
  constructor(context, name, tooltip) {
    this.context = context;
    this.name = name;
    this.tooltip = tooltip;
    this.rowId = ExtensionCommon.makeWidgetId(
      `${context.extension.id}-${name}-custom-hdr`
    );
    this.handlers = new Set();
  }

  destroy() {
    if (this.destroyed)
      throw new Error("Unable to destroy ExtensionScriptParent twice");

    for (let window of Services.wm.getEnumerator("mail:3pane")) {
      try {
        window.document.getElementById(this.rowId).remove();

        for (let i = 0; i < window.gMessageListeners.length; i++) {
          if (window.gMessageListeners[i].id === this.name) {
            window.gMessageListeners.splice(i, 1);
            console.log('Removed gMessageListener for header row:',this.name);
          }
        }
      } catch (ex) {
        console.error(ex);
      }
    }

    this.destroyed = true;
  }

  static waitForWindow(win) {
    return new Promise(resolve => {
      if (win.document.readyState == "complete")
        resolve();
      else
        win.addEventListener( "load", resolve, { once: true } );
    });
  }

  async addToCurrentWindows() {
    for (let window of Services.wm.getEnumerator("mail:3pane")) {
      await CustomHdrRow.waitForWindow(window);
      this.addToWindow(window);
    }
  }

  addToWindow(window) {
    let document = window.document;

    try {
      // If a row already exists, do not create another one
      let newRowNode = document.getElementById(this.rowId);
      if (!newRowNode) {
        // Create new collapsed row
        newRowNode = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div"
        );
        newRowNode.setAttribute("id", this.rowId);
        newRowNode.classList.add("message-header-row");

        let newLabelNode = document.createXULElement("label");
        newLabelNode.setAttribute("id", `${this.rowId}-label`);
        newLabelNode.setAttribute("value", this.name);
        newLabelNode.setAttribute("class", "message-header-label");
        newLabelNode.setAttribute("control", "sendlater-expanded-Box");

        newRowNode.appendChild(newLabelNode);

        // Create and append the new header value.
        let newHeaderNode = document.createXULElement("mail-headerfield");
        newHeaderNode.setAttribute("id", `${this.rowId}-content`);
        newHeaderNode.setAttribute("flex", "1");
        newRowNode.appendChild(newHeaderNode);

        // Add the new row to the extra headers container.
        let topViewNode = document.getElementById("extraHeadersArea")
        topViewNode.appendChild(newRowNode);
      }
    } catch (ex) { // For versions of Thunderbird prior to 96
      console.debug("[hdrViewImplementation]: Using legacy header row implementation");
      // If a row already exists, do not create another one
      let newRowNode = document.getElementById(this.rowId);
      if (!newRowNode) {
        newRowNode = document.createElementNS("http://www.w3.org/1999/xhtml", "tr");
        newRowNode.setAttribute("id", this.rowId);
        let newLabelNode = document.createXULElement("label");
        newLabelNode.setAttribute("id", `${this.rowId}-label`);
        newLabelNode.setAttribute("value", this.name);
        newLabelNode.setAttribute("class", "headerName");
        newLabelNode.setAttribute("control", "sendlater-expanded-Box");
        let newTHNode = document.createElementNS("http://www.w3.org/1999/xhtml", "th");
        newTHNode.appendChild(newLabelNode);
        newRowNode.appendChild(newTHNode);

        // Create and append the new header value.
        let newHeaderNode = document.createXULElement("mail-headerfield");
        newHeaderNode.setAttribute("id", `${this.rowId}-content`);
        newHeaderNode.setAttribute("flex", "1");
        let newTDNode = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
        newTDNode.appendChild(newHeaderNode);

        newRowNode.appendChild(newTDNode);

        // This new element needs to be inserted into the view...
        let topViewNode = document.getElementById("expandedHeaders2");
        topViewNode.appendChild(newRowNode);
      }
    }

    for (let handler of this.handlers)
      this.addMsgListenerToWindow(window, handler);
  }

  async addMsgListenerToCurrentWindows(fire) {
    for (let window of Services.wm.getEnumerator("mail:3pane")) {
      await CustomHdrRow.waitForWindow(window);
      this.addMsgListenerToWindow(window, fire);
    }
  }

  addMsgListenerToWindow(window, handler) {
    this.handlers.add(handler);
    let name = this.name;
    let msgListener = {
      id: name,
      onStartHeaders() {},
      onEndHeaders() {}
    };
    msgListener.onBeforeShowHeaderPane = () => {
      window.document.getElementById(this.rowId).hidden = true;
      if (window.gDBView) {
        try {
          let msgHdr = window.gDBView.hdrForFirstSelectedMessage;
          if (msgHdr) {
            let hdr = this.context.extension.messageManager.convert(msgHdr);
            handler.async(hdr).then(result => {
              window.document.getElementById(this.rowId).hidden = !result.visible;
              window.document.getElementById(`${this.rowId}-content`).headerValue = result.text;
            }).catch(console.error);
          }
        } catch (ex) {}
      }
    };
    window.gMessageListeners.push(msgListener);
  }
}

var headerView = class extends ExtensionCommon.ExtensionAPI {
    close() {
      for (let hdrRow of this.hdrRows.values()) {
        try {
          hdrRow.destroy();
        } catch (ex) {
          console.error("Unable to destroy hdrRow:",ex);
        }
      }

      ExtensionSupport.unregisterWindowListener("customHdrRowWL");
    }

    getAPI(context) {
      context.callOnClose(this);

      ExtensionSupport.registerWindowListener("customHdrRowWL",
        {
          chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
          async onLoadWindow(window) {
            await CustomHdrRow.waitForWindow(window);
            for (let hdrRow of hdrRows.values())
              hdrRow.addToWindow(window);
          }
        });

      let hdrRows = new Map();
      this.hdrRows = hdrRows;

      return {
        headerView: {

          async addCustomHdrRow({ name, tooltip }) {
            if (hdrRows.has(name))
              throw new ExtensionError("Cannot add hdrRows with the same name");
            let hdrRow = new CustomHdrRow(context, name, tooltip);
            await hdrRow.addToCurrentWindows();
            hdrRows.set(name, hdrRow);
          },
  
          async removeCustomHdrRow(name) {
            let hdrRow = hdrRows.get(name);
            if (!hdrRow)
              throw new ExtensionError("Cannot remove non-existent hdrRow");
              hdrRow.destroy();
            hdrRows.delete(name);
          },
  
          onHeaderRowUpdate: new ExtensionCommon.EventManager({
            context,
            name: "headerView.onHeaderRowUpdate",
            register: (fire, name) => {
              let hdrRow = hdrRows.get(name);
              if (!hdrRow) {
                throw new ExtensionError(
                  "Cannot add a hdrRow fill handler for a hdrRow that has not been defined"
                );
              }
              hdrRow.addMsgListenerToCurrentWindows(fire).catch(console.error);
              return () => {};
            },
          }).api()
        }
      }
    }
  };
