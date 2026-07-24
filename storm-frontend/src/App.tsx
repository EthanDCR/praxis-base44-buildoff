import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar/Navbar'
import HailMap from './pages/HailMap/HailMap'
import SpeedDial from './pages/SpeedDial/SpeedDial'
import Leads from './pages/Leads/Leads'

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<HailMap />} />
        <Route path="/speed-dial" element={<SpeedDial />} />
        <Route path="/leads" element={<Leads />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
