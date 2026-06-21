import { Routes, Route, Navigate } from "react-router-dom";
import { ScoringScreen } from "./screens/ScoringScreen";
import { SuiviScreen } from "./screens/SuiviScreen";
import { SystemeScreen } from "./screens/SystemeScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { ShareScreen } from "./screens/ShareScreen";

// Migration strangler (skill pwa-moderne) : 5 écrans portés (vitrine = Scoring).
// Audit UX : la page « Postuler » est supprimée (redondante avec le copilote/extension).
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/scoring" replace />} />
      <Route path="/scoring" element={<ScoringScreen />} />
      <Route path="/suivi" element={<SuiviScreen />} />
      <Route path="/systeme" element={<SystemeScreen />} />
      <Route path="/chat" element={<ChatScreen />} />
      <Route path="/share" element={<ShareScreen />} />
      <Route path="*" element={<Navigate to="/scoring" replace />} />
    </Routes>
  );
}
