export const pharmacyService = {
  async notifyVet(prescriptionId: string) {
    console.log(`[Mock Email] Vet notified for prescription ${prescriptionId}`);
    console.log(`[Mock Push] Notification sent to vet`);
    return true;
  },

  async approveRefill(id: string) {
    console.log(`[Mock Pharmacy] Prescription ${id} approved and sent to pharmacy`);
    return { id, status: 'approved' };
  },

  async denyRefill(id: string) {
    console.log(`[Mock Pharmacy] Prescription ${id} was denied`);
    return { id, status: 'denied' };
  },

  async markReadyForPickup(id: string) {
    console.log(`[Mock Pharmacy] Prescription ${id} is ready for pickup`);

    return {
      id,
      status: 'ready_for_pickup',
      pharmacy: {
        name: 'Mock Pharmacy Abuja',
        address: 'Central Area, Abuja, Nigeria',
        phone: '+234 800 000 0000',
      },
    };
  },
};
