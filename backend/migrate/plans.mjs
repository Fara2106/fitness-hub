// Converter scheda.txt / dieta.txt → record workoutPlan / dietPlan strutturati.
// La logica vive nella PWA (planconv.jsx, window.PlanConv) per avere un'unica
// implementazione tra migrazione e import .txt dell'app; qui viene solo caricata
// in node:vm insieme a parser.jsx e riesportata.
import { loadPlanConv } from "./load-parser.mjs";

const conv = loadPlanConv();

export const workoutPlanFromText = conv.workoutPlanFromText;
export const dietPlanFromText = conv.dietPlanFromText;
