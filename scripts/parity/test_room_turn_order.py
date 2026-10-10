"""Negative evidence must never turn C04 green."""
import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('room_order', Path(__file__).with_name('check-room-turn-order.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RoomOrderTest(unittest.TestCase):
    def setUp(self):
        self.room = {'roomId': 'room', 'rule': 'everyone', 'members': [
            {'id': name, 'kind': 'trunk', 'enabled': True, 'order': i}
            for i, name in enumerate(['first', 'second'])]}
        self.sent = {'event': {'roomId': 'room', 'seq': 1, 'kind': 'message'},
                     'runStarted': True, 'runId': 'run-first'}
        self.events = [
            {'roomId': 'room', 'seq': i + 2, 'kind': kind, 'actorId': actor,
             'payload': {'runId': 'run-' + actor, 'text': 'ack'}}
            for i, (kind, actor) in enumerate([
                ('turn.started', 'first'), ('turn.replied', 'first'),
                ('turn.started', 'second'), ('turn.replied', 'second')])]

    def test_complete_ordered_replies(self):
        self.assertEqual(module.check(self.room, self.sent, self.events)['verdict'], 'PASS')

    def test_rejects_invalid_evidence(self):
        cases = []
        cases.append(self.events[:-1])
        cases.append([self.events[0], self.events[2]])
        for index, field, value in [
            (1, 'kind', 'turn.failed'), (2, 'actorId', 'first'), (2, 'seq', 2)]:
            events = copy.deepcopy(self.events)
            events[index][field] = value
            cases.append(events)
        for field, value in [('runId', 'unrelated'), ('text', ' ' )]:
            events = copy.deepcopy(self.events)
            events[1]['payload'][field] = value
            cases.append(events)
        events = copy.deepcopy(self.events)
        events[1], events[2] = events[2], events[1]
        for i, event in enumerate(events):
            event['seq'] = i + 2
        cases.append(events)
        cases.append(self.events + [{'roomId': 'room', 'seq': 6, 'kind': 'message'}])
        for events in cases:
            with self.subTest(events=events), self.assertRaises(ValueError):
                module.check(self.room, self.sent, events)


if __name__ == '__main__':
    unittest.main()
