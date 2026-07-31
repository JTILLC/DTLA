// shared/config/partsRegister.js
//
// Registers the CCW apps' implementation of the parts data layer with the
// shared UI. Imported once from each app's entry point.
//
// The UI cannot import config/parts.js directly any more: that module uses
// firebase/compat, which Shearers does not have. Injecting it is what makes the
// same component work in all three apps.
import { configureParts } from '../components/parts/partsApi.js';
import {
  fetchPartsForMachine, fetchDiagrams, fetchDiagram, fetchDiagramImage,
} from './parts.js';

configureParts({ fetchPartsForMachine, fetchDiagrams, fetchDiagram, fetchDiagramImage });
