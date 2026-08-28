import express from 'express';

import { pharmacyService } from '../services/pharmacyService';

const router = express.Router();

/**
 * Mock in-memory store (replace with DB later)
 */
const prescriptions: any[] = [
  {
    id: '1',
    name: 'Amoxicillin',
    dosage: '250mg',
    status: 'active',
  },
  {
    id: '2',
    name: 'Ibuprofen',
    dosage: '100mg',
    status: 'active',
  },
];

/**
 * GET all prescriptions
 */
router.get('/', (req, res) => {
  res.json(prescriptions);
});

/**
 * Request refill
 * Owner initiates refill request
 */
router.post('/:id/refill', async (req, res) => {
  const { id } = req.params;

  const prescription = prescriptions.find((p) => p.id === id);

  if (!prescription) {
    return res.status(404).json({ message: 'Prescription not found' });
  }

  prescription.status = 'pending';

  // Notify vet (mock)
  await pharmacyService.notifyVet(id);

  return res.json({
    message: 'Refill requested',
    status: prescription.status,
  });
});

/**
 * Vet approves refill
 */
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;

  const prescription = prescriptions.find((p) => p.id === id);

  if (!prescription) {
    return res.status(404).json({ message: 'Prescription not found' });
  }

  prescription.status = 'approved';

  // Send to pharmacy system (mock)
  await pharmacyService.approveRefill(id);

  return res.json({
    message: 'Refill approved',
    status: prescription.status,
  });
});

/**
 * Vet denies refill
 */
router.post('/:id/deny', async (req, res) => {
  const { id } = req.params;

  const prescription = prescriptions.find((p) => p.id === id);

  if (!prescription) {
    return res.status(404).json({ message: 'Prescription not found' });
  }

  prescription.status = 'denied';

  await pharmacyService.denyRefill(id);

  return res.json({
    message: 'Refill denied',
    status: prescription.status,
  });
});

/**
 * Pharmacy marks ready for pickup
 */
router.post('/:id/ready', async (req, res) => {
  const { id } = req.params;

  const prescription = prescriptions.find((p) => p.id === id);

  if (!prescription) {
    return res.status(404).json({ message: 'Prescription not found' });
  }

  prescription.status = 'ready_for_pickup';

  const result = await pharmacyService.markReadyForPickup(id);

  return res.json({
    message: 'Ready for pickup',
    status: prescription.status,
    pharmacy: result.pharmacy,
  });
});

export default router;
