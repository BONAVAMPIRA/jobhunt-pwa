import { Routes, Route, Navigate } from "react-router-dom";
import { ScoringScreen } from "./screens/ScoringScreen";
import { Placeholder } from "./screens/Placeholder";

// Migration strangler (skill pwa-moderne) : Scoring porté en premier (vitrine).
// Les autres écrans suivent ; placeholders en attendant pour garder l'app navigable.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/scoring" replace />} />
      <Route path="/scoring" element={<ScoringScreen />} />
      <Route path="/chat" element={<Placeholder title="Chat" />} />
      <Route path="/suivi" element={<Placeholder title="Suivi" />} />
      <Route path="/systeme" element={<Placeholder title="Système" />} />
      <Route path="/share" element={<Placeholder title="Partager" />} />
      <Route path="/postuler" element={<Placeholder title="Postuler" />} />
      <Route path="*" element={<Navigate to="/scoring" replace />} />
    </Routes>
  );
}
