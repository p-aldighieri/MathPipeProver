from pathlib import Path
import os

from mathpipeprover.dotenv_loader import load_dotenv


def test_load_dotenv_overrides(tmp_path: Path) -> None:
    env_path = tmp_path / '.env'
    env_path.write_text('OPENAI_API_KEY=abc123\n', encoding='utf-8')

    os.environ['OPENAI_API_KEY'] = 'old'
    loaded = load_dotenv(env_path, override=True)

    assert loaded['OPENAI_API_KEY'] == 'abc123'
    assert os.environ['OPENAI_API_KEY'] == 'abc123'


def test_load_dotenv_no_override(tmp_path: Path) -> None:
    env_path = tmp_path / '.env'
    env_path.write_text('OPENAI_API_KEY=new\n', encoding='utf-8')

    os.environ['OPENAI_API_KEY'] = 'old'
    loaded = load_dotenv(env_path, override=False)

    assert 'OPENAI_API_KEY' not in loaded
    assert os.environ['OPENAI_API_KEY'] == 'old'
