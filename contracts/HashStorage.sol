pragma solidity ^0.5.8;

import "./Ownable.sol";

contract HashStorage is Ownable{
    mapping (string => DocInfo) collection;
    struct DocInfo {
        string ipfshash;
        uint dateAdded; //in epoch
        bool exist; 
    }

    event HashAdded(string ipfshash, string filehash, uint dateAdded);

    constructor () public {
        owner = msg.sender;
    }

    function add(string memory _ipfshash, string memory _filehash, uint _dateAdded) public onlyOwner {
        require(collection[_filehash].exist == false, "this hash already exists in contract");
        DocInfo memory docInfo = DocInfo(_ipfshash, _dateAdded, true);
        collection[_filehash] = docInfo;
        
        emit HashAdded(_ipfshash, _filehash, _dateAdded);
    }

    function get(string memory _hash) public view returns (string memory, string memory, uint, bool) {
        return (
            _hash, 
            collection[_hash].ipfshash,
            collection[_hash].dateAdded,
            collection[_hash].exist
        );
    }
}