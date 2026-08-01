import { BrowserRouter, Route, Routes } from "react-router-dom";
import NavBar from "./components/NavBar";
import Dashboard from "./pages/Dashboard";
import FlightsList from "./pages/FlightsList";
import FlightForm from "./pages/FlightForm";
import Stats from "./pages/Stats";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#f7f9fc]">
        <NavBar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/flights" element={<FlightsList />} />
          <Route path="/flights/new" element={<FlightForm />} />
          <Route path="/flights/:id/edit" element={<FlightForm />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
