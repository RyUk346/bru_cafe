import { BrowserRouter, Routes, Route } from "react-router-dom";
import QuoteFormPage from "./pages/QuoteFormPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import BruRecommendationBoard from "./component/BruRecommendation";

export default function App() {
  return (
    <BrowserRouter basename="/bru_cafe">
      <Routes>
        <Route path="/Screen" element={<BruRecommendationBoard />} />
        <Route path="/Message" element={<QuoteFormPage />} />
        <Route path="/Login" element={<LoginPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
