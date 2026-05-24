const mode = (process.env.START_MODE || "studio").trim().toLowerCase();

if (mode === "hermes-adapter") {
  require("./hermes-gateway-adapter.js");
} else if (mode === "demo-gateway") {
  require("./demo-gateway-adapter.js");
} else {
  require("./index.js");
}
