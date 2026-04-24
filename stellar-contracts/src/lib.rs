#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    VetInfo(Address),
    VetIndex(u64),
    VetCount,
}

#[contracttype]
#[derive(Clone)]
pub struct VetInfo {
    pub address: Address,
    pub name: String,
    pub license: String,
    pub verified: bool,
}

#[contract]
pub struct VetDirectoryContract;

#[contractimpl]
impl VetDirectoryContract {
    /// One-time initialisation — sets the admin.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VetCount, &0u64);
    }

    /// Register a new vet. Only the admin may call this.
    pub fn register_vet(env: Env, vet: Address, name: String, license: String) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::VetInfo(vet.clone())) {
            panic!("vet already registered");
        }

        let info = VetInfo {
            address: vet.clone(),
            name,
            license,
            verified: true,
        };

        let count: u64 = env.storage().instance().get(&DataKey::VetCount).unwrap();
        env.storage().persistent().set(&DataKey::VetInfo(vet), &info);
        env.storage().instance().set(&DataKey::VetIndex(count), &info);
        env.storage().instance().set(&DataKey::VetCount, &(count + 1));
    }

    /// Return a page of verified vets.
    pub fn get_verified_vets(env: Env, offset: u64, limit: u64) -> Vec<VetInfo> {
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VetCount)
            .unwrap_or(0);

        let mut results: Vec<VetInfo> = Vec::new(&env);
        let end = (offset + limit).min(count);

        for i in offset..end {
            if let Some(info) = env
                .storage()
                .instance()
                .get::<DataKey, VetInfo>(&DataKey::VetIndex(i))
            {
                if info.verified {
                    results.push_back(info);
                }
            }
        }
        results
    }
}

#[path = "test_access_control.rs"]
mod test;
