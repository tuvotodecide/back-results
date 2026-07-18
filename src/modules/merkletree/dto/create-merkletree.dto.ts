export type MerkleTreeLeafDto = {
  
}

export type MerkleTreeNodeDto = {

}

export type CreateMerkletreeDto = {
  type: 'ci' | 'vote';
  leaves: MerkleTreeLeafDto[]
  nodes: MerkleTreeNodeDto[]
}
