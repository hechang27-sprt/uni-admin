export interface PrototypeScenario {
  id:
    | 'delegate-polymorphism'
    | 'scope-grant-closure'
    | 'restricted-update-tightening'
    | 'catalog-discriminator-separation';
  question: string;
  expectedObservation: string;
}

export const prototypeScenarios: PrototypeScenario[] = [
  {
    id: 'delegate-polymorphism',
    question:
      'Does a `DocumentBase` delegate hierarchy return concrete managed subtype fields while keeping one shared platform identity?',
    expectedObservation:
      '`DocumentBase` reads surface subtype-specific fields and preserve the shared `documentId` plus discriminator metadata.',
  },
  {
    id: 'scope-grant-closure',
    question:
      'Can an actor with a root grant read a child-scoped row through shared scope closure, while still failing to read a row outside the derived effective scope?',
    expectedObservation:
      'Child-scoped reads succeed for granted descendants and reads outside that derived surface are filtered out.',
  },
  {
    id: 'restricted-update-tightening',
    question:
      'Can a concrete managed subtype tighten the inherited base policy without replacing it?',
    expectedObservation:
      'A normal managed subtype update succeeds under the base rule, while `LockedDocument` rejects the same update path with policy enforcement.',
  },
  {
    id: 'catalog-discriminator-separation',
    question:
      'Can `qualifiedKey` stay global for the delegate discriminator while `collectionKey` remains app-local catalog metadata?',
    expectedObservation:
      'Catalog rows preserve app-local `collectionKey` and globally unique `qualifiedKey` side by side.',
  },
];
