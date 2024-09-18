import RakEngine from "./engines/one-mart/rakEngine.js";
import mongoose from "./config/db.js";

const rakEngine = new RakEngine();
rakEngine.checkRakEngine();
