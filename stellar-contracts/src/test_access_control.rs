#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{VetDirectoryContract, VetDirectoryContractClient};

fn setup() -> (Env, Address, VetDirectoryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, VetDirectoryContract);
    let client = VetDirectoryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.init(&admin);
    (env, admin, client)
}

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

#[test]
fn test_register_and_index() {
    let (env, _admin, client) = setup();
    let vet = Address::generate(&env);
    client.register_vet(&vet, &str(&env, "Dr. Smith"), &str(&env, "LIC-001"));

    let vets = client.get_verified_vets(&0, &10);
    assert_eq!(vets.len(), 1);
    assert_eq!(vets.get(0).unwrap().license, str(&env, "LIC-001"));
}

#[test]
fn test_get_verified_vets_returns_only_verified() {
    let (env, _admin, client) = setup();
    let vet1 = Address::generate(&env);
    let vet2 = Address::generate(&env);
    client.register_vet(&vet1, &str(&env, "Dr. A"), &str(&env, "LIC-A"));
    client.register_vet(&vet2, &str(&env, "Dr. B"), &str(&env, "LIC-B"));

    let vets = client.get_verified_vets(&0, &10);
    assert_eq!(vets.len(), 2);
}

#[test]
fn test_pagination() {
    let (env, _admin, client) = setup();
    for i in 0..5u32 {
        let vet = Address::generate(&env);
        client.register_vet(
            &vet,
            &str(&env, &format!("Dr. {i}")),
            &str(&env, &format!("LIC-{i}")),
        );
    }

    let page1 = client.get_verified_vets(&0, &3);
    let page2 = client.get_verified_vets(&3, &3);
    assert_eq!(page1.len(), 3);
    assert_eq!(page2.len(), 2);
}

#[test]
#[should_panic(expected = "vet already registered")]
fn test_duplicate_registration_panics() {
    let (env, _admin, client) = setup();
    let vet = Address::generate(&env);
    client.register_vet(&vet, &str(&env, "Dr. X"), &str(&env, "LIC-X"));
    client.register_vet(&vet, &str(&env, "Dr. X"), &str(&env, "LIC-X"));
}

#[test]
fn test_empty_directory() {
    let (_env, _admin, client) = setup();
    let vets = client.get_verified_vets(&0, &10);
    assert_eq!(vets.len(), 0);
}

#[test]
fn test_offset_beyond_count_returns_empty() {
    let (env, _admin, client) = setup();
    let vet = Address::generate(&env);
    client.register_vet(&vet, &str(&env, "Dr. Y"), &str(&env, "LIC-Y"));

    let vets = client.get_verified_vets(&99, &10);
    assert_eq!(vets.len(), 0);
}
