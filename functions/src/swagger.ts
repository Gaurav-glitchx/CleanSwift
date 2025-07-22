import * as functions from "firebase-functions";
import express from "express";
import * as swaggerUi from "swagger-ui-express";
import * as YAML from "yamljs";
import * as path from "path";

const swaggerDocument = YAML.load(path.join(__dirname, "../openapi.yaml"));
const app = express();

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export const swaggerDocs = functions.https.onRequest(app);
