import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import commands from './commands.json';

/** Discord rejects the whole registration if any command or option breaks these limits. */
const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

interface Option {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  min_value?: number;
  max_value?: number;
  max_length?: number;
}

describe('commands.json (Discord limits)', () => {
  it('has unique command names', () => {
    const names = commands.map((command) => command.name);
    assert.equal(new Set(names).size, names.length);
  });

  for (const command of commands) {
    describe(`/${command.name}`, () => {
      const options = command.options as Option[];

      it('has a valid, lower-case name and a description of 1-100 characters', () => {
        assert.match(command.name, NAME);
        assert.equal(command.name, command.name.toLowerCase());
        assert.ok(
          command.description.length >= 1 && command.description.length <= 100,
          `command description is ${command.description.length} characters`,
        );
      });

      it('has at most 25 options, required ones first', () => {
        assert.ok(options.length <= 25);
        const firstOptional = options.findIndex((option) => !option.required);
        if (firstOptional !== -1) {
          assert.ok(
            options.slice(firstOptional).every((option) => !option.required),
            'a required option comes after an optional one',
          );
        }
      });

      for (const option of options) {
        it(`option "${option.name}" is valid`, () => {
          assert.match(option.name, NAME);
          assert.equal(option.name, option.name.toLowerCase());
          assert.ok(
            option.description.length >= 1 && option.description.length <= 100,
            `description is ${option.description.length} characters, the limit is 100`,
          );
          assert.ok((option.choices?.length ?? 0) <= 25);
          for (const choice of option.choices ?? []) {
            assert.ok(choice.name.length >= 1 && choice.name.length <= 100);
            if (typeof choice.value === 'string') assert.ok(choice.value.length <= 100);
          }
          if (option.max_length !== undefined)
            assert.ok(option.max_length >= 1 && option.max_length <= 6000);
        });
      }
    });
  }
});
