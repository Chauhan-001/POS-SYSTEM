import { useState } from 'react';
import { motion } from 'framer-motion';
import { Marquee, Squiggle } from '../components/bits';

/**
 * Car-mode gate screen — driver details are required before ordering
 * (drive-off prevention). Saves locally; the phone + plate ride along on
 * every order + waiter call so staff can find the car.
 */
export default function CarForm({ qr, onSubmit }) {
  const [carNumber, setCarNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [parkingSlot, setParkingSlot] = useState(qr?.parkingSlot || '');
  const [errors, setErrors] = useState({});

  const submit = () => {
    const e = {};
    if (carNumber.trim().length < 4) e.carNumber = 'Enter your car number, e.g. GJ01AB1234';
    if (!/^\d{10}$/.test(phone)) e.phone = '10 digits, please';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSubmit({
      carNumber: carNumber.trim().toUpperCase(),
      phone,
      name: name.trim() || undefined,
      parkingSlot: parkingSlot.trim().toUpperCase() || undefined,
    });
  };

  return (
    <div className="shell">
      <div className="page">
        <h1 className="hero-title" style={{ fontSize: 42 }}>
          Drive-in <span className="bolt">mode</span> 🚗
        </h1>
        <span className="sticker sticker-teal">We bring the food to your car</span>
        <Squiggle color="#2A9D8F" />

        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <span className="field-label">Car number *</span>
          <input
            className="input"
            style={{ textTransform: 'uppercase' }}
            placeholder="GJ01AB1234"
            maxLength={12}
            value={carNumber}
            onChange={(e) => setCarNumber(e.target.value.toUpperCase().replace(/\s/g, ''))}
          />
          {errors.carNumber && <div className="field-error">{errors.carNumber}</div>}

          <span className="field-label">Phone *</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="9876543210"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
          {errors.phone && <div className="field-error">{errors.phone}</div>}

          <span className="field-label">Your name (optional)</span>
          <input
            className="input"
            placeholder="Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <span className="field-label">Parking slot</span>
          <input
            className="input"
            placeholder="P1"
            value={parkingSlot}
            onChange={(e) => setParkingSlot(e.target.value.toUpperCase())}
          />

          <motion.button
            className="btn btn-ketchup btn-block btn-lg mt"
            whileTap={{ scale: 0.95 }}
            onClick={submit}
          >
            Start Ordering ⚡
          </motion.button>
          <p className="muted center mt" style={{ marginBottom: 0 }}>
            Staff will find your car — number & slot help them zoom to you.
          </p>
        </motion.div>
      </div>
      <Marquee />
    </div>
  );
}
