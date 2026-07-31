// src/config/partsRegister.js
//
// Registers this app's implementation of the parts data layer with the shared
// UI. Imported once from main.jsx.
//
// Same components as the CCW apps, but this app talks to the broker with the
// modular Firebase SDK and may only ask about its own plants — which is exactly
// why the UI takes the data layer by injection instead of importing one.
import { configureParts } from '@shared/components/parts/partsApi.js';
import {
  fetchPartsForMachine, fetchDiagrams, fetchDiagram, fetchDiagramImage,
} from './parts';

configureParts({ fetchPartsForMachine, fetchDiagrams, fetchDiagram, fetchDiagramImage });
