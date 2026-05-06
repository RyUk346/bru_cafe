import { BrowserRouter, Routes, Route } from "react-router-dom";
import QuoteFormPage from "./pages/QuoteFormPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import BruRecommendationBoard from "./component/BruRecommendation";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/BruCafe/Screen" element={<BruRecommendationBoard />} />
        <Route path="/BruCafe/Message" element={<QuoteFormPage />} />
        <Route path="/BruCafe/Login" element={<LoginPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
